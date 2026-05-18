// src/services/agentPipeline.js
const Order = require('../models/Order');
const { extractClaims, verifyClaims, assistAgent } = require('./ollamaService');
const logger = require('../utils/logger');

const pipelineState = new Map();

function extractClaimsQuick(transcript) {
  const orderMatch = transcript.match(/ORD-\d{4}-\d{5}/i) || transcript.match(/order\s(?:number\s)?(\d{4,6})/i);
  const phoneMatch = transcript.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,3}\s?\d{3,})/);
  const emailMatch = transcript.match(/[\w.-]+@[\w.-]+\.\w+/i);

  let orderId = null;
  if (orderMatch) {
    if (orderMatch[0].toUpperCase().startsWith('ORD-')) {
      orderId = orderMatch[0].toUpperCase();
    } else if (orderMatch[1]) {
      orderId = `ORD-2024-${String(orderMatch[1]).padStart(5, '0')}`;
    }
  }

  return { orderId, phone: phoneMatch ? phoneMatch[0] : null, email: emailMatch ? emailMatch[0] : null };
}

async function runAgentPromptPipeline(callId, transcript, io) {
  if (!pipelineState.has(callId)) {
    pipelineState.set(callId, { isVerified: false, orderId: null, orderData: null, lastTranscriptLength: 0 });
  }
  const state = pipelineState.get(callId);

  // Throttle
  if (transcript.length - state.lastTranscriptLength < 30 && transcript.length !== 0) {
    return;
  }
  state.lastTranscriptLength = transcript.length;

  try {
    const claims = extractClaimsQuick(transcript);
    
    if (claims.orderId && !state.orderId) {
       const o = await Order.findOne({ orderId: claims.orderId });
       if (o) {
         state.orderId = o.orderId;
         state.orderData = o.toObject();
       }
    }

    if (!state.isVerified) {
       const extraction = await extractClaims(transcript);
       const verification = await verifyClaims(extraction, state.orderData);
       
       if (verification && verification.is_verified && state.orderData) {
           state.isVerified = true;
           const assist = await assistAgent(transcript, state.orderData);
           io.to(callId).emit('call:stream:agent_assist', { callId, ...assist });
       } else {
           io.to(callId).emit('call:stream:verification', {
               callId,
               status: 'NOT_VERIFIED',
               orderFound: !!state.orderData,
               checklist: verification ? verification.verification_checklist : {},
               script: verification ? verification.agent_script : "Could you please provide your details?"
           });
       }
    } else {
       const assist = await assistAgent(transcript, state.orderData);
       io.to(callId).emit('call:stream:agent_assist', { callId, ...assist });
       if (assist && assist.flags && assist.flags.length > 0) {
           assist.flags.forEach(flag => io.to(callId).emit('call:stream:flag', { callId, flag }));
       }
    }
  } catch (err) {
      logger.error('Agent Pipeline Error', { err: err.message });
  }
}

function endPipelineSession(callId) {
    pipelineState.delete(callId);
}

module.exports = { runAgentPromptPipeline, endPipelineSession };
