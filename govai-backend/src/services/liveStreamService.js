// src/services/liveStreamService.js
// Receives audio chunks -> AWS transcription -> verification-aware
// Ollama agent prompt pipeline → emits results back to frontend.

const config   = require('../config');
const logger   = require('../utils/logger');
const Order    = require('../models/Order');
const CallLog  = require('../models/CallLog');
const { evaluateGovernance }                         = require('./governanceService');
const { runAgentPromptPipeline, VERIFICATION_STAGE } = require('./agentPromptService');
const { initiateIssueTicket }                        = require('./issueTicketService');
const { uploadAudio }                                = require('./s3Service');
const { transcribeAudio }                            = require('./transcribeService');

// ─── In-memory call state ─────────────────────────────────────────────────────
const activeCalls = new Map();
const endedCalls = new Set();

const MOCK_SENTENCES = [
  "Hello, I need help with my order.",
  "My name is Sarah Mitchell and my order number is ORD-2024-01001.",
  "I am very upset — the delivery hasn't arrived and I want a refund.",
  "This is unacceptable. I want to speak to a manager.",
  "Can you check the status of my delivery please?",
];

const MIN_TRANSCRIPT_CHARS_TO_ANALYZE = 8;
const TRANSCRIPT_GROWTH_CHARS_TO_ANALYZE = 20;

// ─── State helpers ────────────────────────────────────────────────────────────
function initCall(callId) {
  endedCalls.delete(callId);
  if (!activeCalls.has(callId)) {
    activeCalls.set(callId, {
      transcript:          '',
      chunkCount:          0,
      lastAnalyzedLength:  0,
      verificationStage:   VERIFICATION_STAGE.UNVERIFIED,
      verifiedOrder:       null,  // set after DB lookup; used for verification compare
      conversationHistory: [],    // [{ role: 'customer'|'agent', text }]
    });
    logger.info('Live call initialised', { callId });
  }
}

async function endCall(callId) {
  const state = activeCalls.get(callId);
  if (state?.transcript) {
    await saveLiveCallLog(callId, state, { processingStatus: 'COMPLETED' });
  }
  activeCalls.delete(callId);
  endedCalls.add(callId);
  logger.info('Live call state cleared', { callId });
}

function liveRoom(callId) {
  return `live:${callId}`;
}

function emitLive(io, callId, event, payload) {
  io.to(liveRoom(callId)).emit(event, payload);
}

// ─── AWS transcription ────────────────────────────────────────────────────────
async function transcribeChunk(audioBuffer, callId, chunkCount) {
  try {
    const upload = await uploadAudio(audioBuffer, `${callId}-${chunkCount}.webm`, 'audio/webm');
    const result = await transcribeAudio(upload.key, `${callId}-${chunkCount}`);
    return result.transcript?.trim() ?? '';
  } catch (err) {
    logger.error('AWS chunk transcription failed', {
      callId,
      chunkCount,
      error: err.message || err.code || 'Unknown transcription error',
    });
    return '';
  }
}

// ─── DB lookup ────────────────────────────────────────────────────────────────
/**
 * Regex pre-extraction — fast, no LLM needed.
 * Pulls order ID / email / phone directly from transcript text.
 * Names are too ambiguous for regex; the LLM handles those.
 */
function extractClaimsQuick(transcript) {
  const orderMatch = transcript.match(/ORD-\d{4}-\d{5}/i) || transcript.match(/order\s(?:number\s)?([A-Z0-9-]*\d[A-Z0-9-]*)/i);
  const nameMatch = transcript.match(/(?:my name is|this is|i am)\s+([a-z][a-z\s.'-]{2,})/i);
  return {
    claimedOrderId: orderMatch?.[1] || orderMatch?.[0] || null,
    claimedEmail:   (transcript.match(/[\w.+-]+@[\w-]+\.\w+/) ?? [])[0] ?? null,
    claimedPhone:   (transcript.match(/(?:\+?\d[\d\s().-]{7,}\d|0\d{2}[-\s]?\d{3}[-\s]?\d{4})/) ?? [])[0] ?? null,
    claimedName:    nameMatch?.[1]?.trim() || null,
  };
}

async function lookupOrderFromClaims(claims) {
  try {
    const { claimedOrderId, claimedEmail, claimedPhone } = claims;
    const orClauses = [];
    if (claimedOrderId) orClauses.push({ orderId: claimedOrderId });
    if (claimedEmail)   orClauses.push({ 'customer.email': claimedEmail });
    if (claimedPhone) {
      const compactPhone = claimedPhone.replace(/\D/g, '');
      orClauses.push(
        { 'customer.phone': claimedPhone },
        { 'customer.alternatePhone': claimedPhone },
        { 'customer.alternatePhone': compactPhone }
      );
    }
    if (!orClauses.length) return null;
    return await Order.findOne({ $or: orClauses }).lean();
  } catch (err) {
    logger.warn('Order lookup failed', { error: err.message });
    return null;
  }
}

async function lookupVerificationCandidates(transcript, claims, limit = 20) {
  try {
    const orClauses = [];
    if (claims.claimedOrderId) orClauses.push({ orderId: claims.claimedOrderId });
    if (claims.claimedEmail) orClauses.push({ 'customer.email': claims.claimedEmail });
    if (claims.claimedPhone) {
      const compactPhone = claims.claimedPhone.replace(/\D/g, '');
      orClauses.push(
        { 'customer.phone': claims.claimedPhone },
        { 'customer.alternatePhone': claims.claimedPhone },
        { 'customer.phone': compactPhone },
        { 'customer.alternatePhone': compactPhone }
      );
    }
    if (claims.claimedName) {
      orClauses.push({ 'customer.name': new RegExp(escapeRegex(claims.claimedName), 'i') });
    }

    if (!orClauses.length) {
      return Order.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    }

    return Order.find({ $or: orClauses }).sort({ createdAt: -1 }).limit(limit).lean();
  } catch (err) {
    logger.warn('Verification candidate lookup failed', { error: err.message });
    return [];
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quickEntitiesFromTranscript(transcript) {
  const claims = extractClaimsQuick(transcript);
  return {
    order_id: claims.claimedOrderId || '',
    email:    claims.claimedEmail || '',
    phone:    claims.claimedPhone || '',
    name:     claims.claimedName || '',
  };
}

async function saveLiveCallLog(callId, state, options = {}) {
  try {
    const {
      result = null,
      issueTicket = null,
      processingStatus = 'PROCESSING',
      error = null,
    } = options;

    const extractedEntities = result?.extracted?.entities || {};
    const quickEntities = quickEntitiesFromTranscript(state.transcript);
    const entities = {
      order_id: extractedEntities.order_id || state.verifiedOrder?.orderId || quickEntities.order_id || '',
      email:    extractedEntities.email || state.verifiedOrder?.customer?.email || quickEntities.email || '',
      phone:    extractedEntities.phone || state.verifiedOrder?.customer?.phone || quickEntities.phone || '',
      name:     extractedEntities.name || state.verifiedOrder?.customer?.name || quickEntities.name || '',
    };

    const confidence = result?.confidence ?? result?.confidenceScore ?? null;
    const flags = result?.flags || [];

    const set = {
      agent_id: 'LIVE_AGENT',
      customer_id: state.verifiedOrder?.customer?.customerId || state.verifiedOrder?.customer?.email || entities.email || '',
      order_id: state.verifiedOrder?.orderId || entities.order_id || '',
      issue_ticket_id: issueTicket?.ticket_id || undefined,
      transcript: state.transcript,
      user_input: state.transcript,
      system_processed_input: result?.extracted?.cleaned_input || state.transcript,
      intent: result?.intent || result?.extracted?.intent || '',
      entities,
      verification: {
        stage: state.verificationStage,
        result: result?.verificationResult || null,
        matched_fields: result?.matchedFields || [],
        mismatched_fields: result?.mismatchedFields || [],
        confidence_score: confidence,
        verified_at: state.verificationStage === VERIFICATION_STAGE.VERIFIED ? new Date() : null,
      },
      agent_stage: state.verificationStage,
      status: state.verificationStage === VERIFICATION_STAGE.VERIFIED ? 'verified' : 'pending',
      processing_status: error ? 'FAILED' : processingStatus,
      notes: error || result?.summary || result?.agentScript || 'Live call transcript captured.',
      ai_result: {
        intent: result?.intent || result?.extracted?.intent || '',
        summary: result?.summary || result?.agentScript || '',
        confidence,
        sentiment: result?.sentiment || result?.extracted?.sentiment || '',
        agent_action: result?.agentAction || '',
        action_payload: result?.actionPayload || null,
      },
      governance_result: {
        status: flags.length ? 'REVIEW_REQUIRED' : 'APPROVED',
        governance_score: confidence != null ? Math.round(confidence * 100) : 0,
        flags,
        masked_transcript: state.transcript,
      },
    };

    Object.keys(set).forEach(key => {
      if (set[key] === undefined) delete set[key];
    });

    await CallLog.findOneAndUpdate(
      { call_id: callId },
      {
        $set: set,
        $setOnInsert: {
          call_id: callId,
          timestamp: new Date(),
          pipeline_stages: [{
            stage: 'LIVE_CALL',
            status: 'SUCCESS',
            message: 'Live transcript captured',
            duration_ms: 0,
            completed_at: new Date(),
          }],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logger.info('Live call log saved to MongoDB', { callId, processingStatus: set.processing_status });
  } catch (dbErr) {
    logger.error('Failed to save live CallLog', { callId, error: dbErr.message });
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
async function processLiveChunk(callId, audioBuffer, io) {
  if (endedCalls.has(callId)) {
    logger.debug('Ignoring audio chunk for ended live call', { callId });
    return;
  }

  initCall(callId);
  const state = activeCalls.get(callId);
  state.chunkCount++;

  // Normalise buffer type
  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

  // ── 1. Transcribe audio chunk ──────────────────────────────────────────────
  let newText = '';
  if (config.useMockAws) {
    newText = MOCK_SENTENCES[(state.chunkCount - 1) % MOCK_SENTENCES.length] + ' ';
    await new Promise(r => setTimeout(r, 400));
  } else {
    const text = await transcribeChunk(buf, callId, state.chunkCount);
    newText = text ? text + ' ' : '';
  }

  if (!newText.trim()) return; // nothing transcribed — skip

  await processTranscriptText(callId, state.transcript + newText, io, newText.trim());
}

async function processLiveTranscript(callId, text, io) {
  if (endedCalls.has(callId)) {
    logger.debug('Ignoring transcript for ended live call', { callId });
    return;
  }

  initCall(callId);
  await processTranscriptText(callId, text, io);
}

async function processTranscriptText(callId, fullTranscript, io, newSegment = null) {
  const state = activeCalls.get(callId);
  const nextTranscript = String(fullTranscript || '').trim();
  if (!state || !nextTranscript) return;

  if (nextTranscript.length <= state.transcript.length) return;

  const segment = newSegment || nextTranscript.slice(state.transcript.length).trim();
  state.transcript = nextTranscript;
  if (segment) state.conversationHistory.push({ role: 'customer', text: segment });

  // Emit live transcript immediately
  emitLive(io, callId, 'call:stream:transcript', { callId, text: state.transcript });
  await saveLiveCallLog(callId, state, { processingStatus: 'PROCESSING' });

  // ── 2. Throttle: only run AI pipeline when transcript grows enough ─────────
  const isFirstAnalysis = state.lastAnalyzedLength === 0;
  const hasMeaningfulTranscript = state.transcript.length >= MIN_TRANSCRIPT_CHARS_TO_ANALYZE;
  const transcriptGrew = state.transcript.length >= state.lastAnalyzedLength + TRANSCRIPT_GROWTH_CHARS_TO_ANALYZE;
  if ((!isFirstAnalysis || !hasMeaningfulTranscript) && !transcriptGrew) return;
  state.lastAnalyzedLength = state.transcript.length;

  try {
    // ── 3. Pre-fetch order from DB (if not yet found) ────────────────────────
    const claims = extractClaimsQuick(state.transcript);
    let verificationCandidates = [];
    if (!state.verifiedOrder) {
      const hasAnyClaim = Object.values(claims).some(v => v !== null);
      if (hasAnyClaim) {
        const order = await lookupOrderFromClaims(claims);
        if (order) {
          state.verifiedOrder = order;
          logger.info('Order pre-fetched for verification', { callId, orderId: order.orderId });
        }
      }
    }

    // ── 4. Run verification-aware Ollama pipeline ────────────────────────────
    verificationCandidates = await lookupVerificationCandidates(state.transcript, claims);

    const result = await runAgentPromptPipeline({
      transcript:          state.transcript,
      verificationStage:   state.verificationStage,
      orderOnFile:         state.verifiedOrder,
      verificationCandidates,
      conversationHistory: state.conversationHistory,
    });

    // ── 5. Persist updated verification stage ────────────────────────────────
    if (result.selectedOrderId && (!state.verifiedOrder || state.verifiedOrder.orderId !== result.selectedOrderId)) {
      const selectedOrder = await Order.findOne({ orderId: result.selectedOrderId }).lean();
      if (selectedOrder) {
        state.verifiedOrder = selectedOrder;
        logger.info('Order selected from Bedrock verification', { callId, orderId: selectedOrder.orderId });
      }
    }

    if (result.verificationStage) {
      const prev = state.verificationStage;
      state.verificationStage = result.verificationStage;
      if (prev !== result.verificationStage) {
        logger.info('Verification stage changed', {
          callId,
          from: prev,
          to:   result.verificationStage,
        });
      }
    }

    // ── 5.5 DB Call Logging (Mandatory) ──────────────────────────────────────
    try {
      const entities = result.extracted?.entities || {};
      await CallLog.findOneAndUpdate(
        { call_id: callId },
        {
          call_id: callId,
          timestamp: new Date(),
          customer_id: state.verifiedOrder?.customer?.customerId || state.verifiedOrder?.customer?.email || entities.email || '',
          order_id: state.verifiedOrder?.orderId || entities.order_id || '',
          transcript: state.transcript,
          user_input: state.transcript,
          system_processed_input: result.extracted?.cleaned_input || '',
          intent: result.intent || result.extracted?.intent || '',
          entities: {
            order_id: entities.order_id || state.verifiedOrder?.orderId || '',
            email: entities.email || state.verifiedOrder?.customer?.email || '',
            phone: entities.phone || state.verifiedOrder?.customer?.phone || '',
            name: entities.name || state.verifiedOrder?.customer?.name || '',
          },
          verification: {
            stage: state.verificationStage,
            result: result.verificationResult || null,
            matched_fields: result.matchedFields || [],
            mismatched_fields: result.mismatchedFields || [],
            confidence_score: result.confidenceScore || result.confidence || null,
            verified_at: state.verificationStage === VERIFICATION_STAGE.VERIFIED ? new Date() : null,
          },
          agent_stage: state.verificationStage,
          status: state.verificationStage === VERIFICATION_STAGE.VERIFIED ? 'verified' : 'pending',
          processing_status: 'COMPLETED',
          ai_result: {
            intent: result.intent || result.extracted?.intent || '',
            summary: result.summary || result.agentScript || '',
            confidence: result.confidence || result.confidenceScore || null,
            sentiment: result.sentiment || result.extracted?.sentiment || '',
            agent_action: result.agentAction || '',
            action_payload: result.actionPayload || null,
          },
          governance_result: {
            status: result.flags?.length ? 'REVIEW_REQUIRED' : 'APPROVED',
            governance_score: Math.round((result.confidence || result.confidenceScore || 0) * 100),
            flags: result.flags || [],
            masked_transcript: state.transcript,
          },
          notes: result.summary || result.agentScript || '',
        },
        { upsert: true, new: true }
      );
      logger.info('Call interaction logged to DB', { callId });
    } catch (dbErr) {
      logger.error('Failed to save CallLog', { callId, error: dbErr.message });
    }

    let issueTicket = null;
    try {
      if (state.verificationStage === VERIFICATION_STAGE.VERIFIED) {
        issueTicket = await initiateIssueTicket({
          callId,
          order: state.verifiedOrder,
          transcript: state.transcript,
          result,
          source: 'LIVE_CALL',
        });
      }
    } catch (ticketErr) {
      logger.error('Failed to initiate issue ticket', { callId, error: ticketErr.message });
    }

    // ── 6. Emit agent assist result to frontend ───────────────────────────────
    await saveLiveCallLog(callId, state, {
      result,
      issueTicket,
      processingStatus: 'COMPLETED',
    });

    emitLive(io, callId, 'call:stream:agent_assist', {
      callId,
      // Core
      type:              result.type,
      verificationStage: result.verificationStage,
      agentScript:       result.agentScript,
      // Verification fields (null when VERIFIED)
      verificationResult: result.verificationResult ?? null,
      matchedFields:      result.matchedFields      ?? null,
      mismatchedFields:   result.mismatchedFields   ?? null,
      nextStep:           result.nextStep            ?? null,
      confidenceScore:    result.confidenceScore     ?? null,
      // Post-verification fields (null before VERIFIED)
      intent:             result.intent             ?? null,
      sentiment:          result.sentiment          ?? null,
      confidence:         result.confidence         ?? null,
      summary:            result.summary            ?? null,
      agentAction:        result.agentAction        ?? null,
      actionPayload:      result.actionPayload      ?? null,
      flags:              result.flags              ?? [],
      governance:         result.governance         ?? null,
      issueTicket:        issueTicket ? {
        ticket_id: issueTicket.ticket_id,
        issue_type: issueTicket.issue_type,
        priority: issueTicket.priority,
        status: issueTicket.status,
      } : null,
    });

    if (issueTicket) {
      emitLive(io, callId, 'call:stream:ticket', {
        callId,
        ticket: {
          ticket_id: issueTicket.ticket_id,
          issue_type: issueTicket.issue_type,
          priority: issueTicket.priority,
          status: issueTicket.status,
          summary: issueTicket.summary,
        },
      });
    }

    // ── 7. Feed existing Real-time Analysis panel when verified ───────────────
    if (result.type === 'AGENT_ASSIST') {
      emitLive(io, callId, 'call:stream:analysis', {
        callId,
        intent:     result.intent,
        sentiment:  result.sentiment,
        confidence: result.confidence,
      });
    }

    // ── 8. Governance rule engine ─────────────────────────────────────────────
    const govResult = evaluateGovernance(result, state.transcript);
    govResult.flags?.forEach(flag => {
      emitLive(io, callId, 'call:stream:flag', { callId, flag });
    });

    // Surface verification failure as a governance flag
    if (result.verificationStage === VERIFICATION_STAGE.FAILED) {
      emitLive(io, callId, 'call:stream:flag', { callId, flag: 'VERIFICATION_FAILED' });
    }

  } catch (err) {
    logger.error('Agent prompt pipeline error', { callId, error: err.message });
    await saveLiveCallLog(callId, state, {
      processingStatus: 'FAILED',
      error: err.message,
    });
    emitLive(io, callId, 'call:stream:error', {
      callId,
      source:  'agent_assist',
      message: 'Agent assist temporarily unavailable.',
    });
  }
}

module.exports = { processLiveChunk, processLiveTranscript, endCall };
