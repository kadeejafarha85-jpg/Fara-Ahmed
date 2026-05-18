// src/services/liveStreamService.js
// Receives audio chunks → Whisper transcription → verification-aware
// Ollama agent prompt pipeline → emits results back to frontend.

const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { v4: uuidv4 } = require('uuid');
const axios    = require('axios');
const FormData = require('form-data');
const config   = require('../config');
const logger   = require('../utils/logger');
const Order    = require('../models/Order');
const CallLog  = require('../models/CallLog');
const { evaluateGovernance }                         = require('./governanceService');
const { runAgentPromptPipeline, VERIFICATION_STAGE } = require('./agentPromptService');

// ─── In-memory call state ─────────────────────────────────────────────────────
const activeCalls = new Map();

const MOCK_SENTENCES = [
  "Hello, I need help with my order.",
  "My name is Sarah Mitchell and my order number is ORD-2024-01001.",
  "I am very upset — the delivery hasn't arrived and I want a refund.",
  "This is unacceptable. I want to speak to a manager.",
  "Can you check the status of my delivery please?",
];

const WHISPER_TIMEOUT_MS = 12_000;

// ─── State helpers ────────────────────────────────────────────────────────────
function initCall(callId) {
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

function endCall(callId) {
  activeCalls.delete(callId);
  logger.info('Live call state cleared', { callId });
}

// ─── Whisper transcription ────────────────────────────────────────────────────
async function transcribeChunk(audioBuffer) {
  const tempFile = path.join(os.tmpdir(), `chunk-${uuidv4()}.webm`);
  try {
    fs.writeFileSync(tempFile, audioBuffer);
    const form = new FormData();
    form.append('file', fs.createReadStream(tempFile), {
      filename:    'chunk.webm',
      contentType: 'audio/webm',
    });
    form.append('response_format', 'json');

    const res = await axios.post(`${config.whisper.url}/inference`, form, {
      headers: form.getHeaders(),
      timeout: WHISPER_TIMEOUT_MS,
    });
    return res.data?.text?.trim() ?? '';
  } catch (err) {
    logger.error('Whisper chunk transcription failed', { error: err.message });
    return '';
  } finally {
    try { fs.unlinkSync(tempFile); } catch { /* already cleaned up */ }
  }
}

// ─── DB lookup ────────────────────────────────────────────────────────────────
/**
 * Regex pre-extraction — fast, no LLM needed.
 * Pulls order ID / email / phone directly from transcript text.
 * Names are too ambiguous for regex; the LLM handles those.
 */
function extractClaimsQuick(transcript) {
  return {
    claimedOrderId: (transcript.match(/ORD-\d{4}-\d{5}/i) ?? [])[0] ?? null,
    claimedEmail:   (transcript.match(/[\w.+-]+@[\w-]+\.\w+/) ?? [])[0] ?? null,
    claimedPhone:   (transcript.match(/0\d{2}[-\s]?\d{3}[-\s]?\d{4}/) ?? [])[0] ?? null,
    claimedName:    null,
  };
}

async function lookupOrderFromClaims(claims) {
  try {
    const { claimedOrderId, claimedEmail, claimedPhone } = claims;
    const orClauses = [];
    if (claimedOrderId) orClauses.push({ orderId: claimedOrderId });
    if (claimedEmail)   orClauses.push({ 'customer.email': claimedEmail });
    if (claimedPhone)   orClauses.push({ 'customer.phone': claimedPhone });
    if (!orClauses.length) return null;
    return await Order.findOne({ $or: orClauses }).lean();
  } catch (err) {
    logger.warn('Order lookup failed', { error: err.message });
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
async function processLiveChunk(callId, audioBuffer, io) {
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
    const text = await transcribeChunk(buf);
    newText = text ? text + ' ' : '';
  }

  if (!newText.trim()) return; // nothing transcribed — skip

  state.transcript += newText;
  state.conversationHistory.push({ role: 'customer', text: newText.trim() });

  // Emit live transcript immediately
  io.to(callId).emit('call:stream:transcript', { callId, text: state.transcript });

  // ── 2. Throttle: only run AI pipeline when transcript grows enough ─────────
  const transcriptGrew = state.transcript.length > state.lastAnalyzedLength + 40;
  if (!transcriptGrew) return;
  state.lastAnalyzedLength = state.transcript.length;

  try {
    // ── 3. Pre-fetch order from DB (if not yet found) ────────────────────────
    if (!state.verifiedOrder) {
      const claims = extractClaimsQuick(state.transcript);
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
    const result = await runAgentPromptPipeline({
      transcript:          state.transcript,
      verificationStage:   state.verificationStage,
      orderOnFile:         state.verifiedOrder,
      conversationHistory: state.conversationHistory,
      ollamaUrl:           config.ollama.url,
      ollamaModel:         config.ollama.model,
    });

    // ── 5. Persist updated verification stage ────────────────────────────────
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
      const logEntry = new CallLog({
        call_id: callId,
        timestamp: new Date(),
        user_input: state.transcript,
        system_processed_input: result.extracted?.cleaned_input || '',
        intent: result.extracted?.intent || '',
        entities: {
          order_id: result.extracted?.entities?.order_id || '',
          email: result.extracted?.entities?.email || '',
          phone: result.extracted?.entities?.phone || '',
          name: result.extracted?.entities?.name || '',
        },
        agent_stage: state.verificationStage,
        status: state.verificationStage === VERIFICATION_STAGE.VERIFIED ? 'verified' : 'pending',
        notes: result.summary || result.agentScript || ''
      });
      await logEntry.save();
      logger.info('Call interaction logged to DB', { callId });
    } catch (dbErr) {
      logger.error('Failed to save CallLog', { callId, error: dbErr.message });
    }

    // ── 6. Emit agent assist result to frontend ───────────────────────────────
    io.to(callId).emit('call:stream:agent_assist', {
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
    });

    // ── 7. Feed existing Real-time Analysis panel when verified ───────────────
    if (result.type === 'AGENT_ASSIST') {
      io.to(callId).emit('call:stream:analysis', {
        callId,
        intent:     result.intent,
        sentiment:  result.sentiment,
        confidence: result.confidence,
      });
    }

    // ── 8. Governance rule engine ─────────────────────────────────────────────
    const govResult = evaluateGovernance(result, state.transcript);
    govResult.flags?.forEach(flag => {
      io.to(callId).emit('call:stream:flag', { callId, flag });
    });

    // Surface verification failure as a governance flag
    if (result.verificationStage === VERIFICATION_STAGE.FAILED) {
      io.to(callId).emit('call:stream:flag', { callId, flag: 'VERIFICATION_FAILED' });
    }

  } catch (err) {
    logger.error('Agent prompt pipeline error', { callId, error: err.message });
    io.to(callId).emit('call:stream:error', {
      callId,
      source:  'agent_assist',
      message: 'Agent assist temporarily unavailable.',
    });
  }
}

module.exports = { processLiveChunk, endCall };
