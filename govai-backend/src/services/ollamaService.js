// src/services/ollamaService.js
const axios   = require('axios');
const config  = require('../config');
const logger  = require('../utils/logger');
const { withRetry } = require('../utils/retry');

async function queryOllama(systemPrompt, userPrompt, jsonFormat = true) {
  if (config.useMockOllama) {
     return null; // Mock is handled inside each function wrapper directly
  }
  
  const payload = {
    model: config.ollama.model,
    format: jsonFormat ? 'json' : undefined,
    stream: false,
    options: { temperature: 0.1 },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  const endpoint = `${config.ollama.url}/api/chat`;
  
  const response = await withRetry(
    () => axios.post(endpoint, payload, { timeout: 60000 }),
    config.retry.maxRetries,
    config.retry.delayMs,
    'Ollama Chat API'
  );

  let text = response.data?.message?.content || '';
  logger.debug('Ollama raw response', { length: text.length });

  if (jsonFormat) {
    try {
      return JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]+\}/);
      if (match) return JSON.parse(match[0]);
      return {}; 
    }
  }
  return text;
}

async function extractClaims(transcript) {
  if (config.useMockOllama) {
    await new Promise(r => setTimeout(r, 400));
    const t = transcript.toLowerCase();
    return {
      claimed_name: t.includes('james') || t.includes('sarah') || t.includes('lisa') || t.includes('robert') ? 'Customer' : null,
      claimed_intent: t.includes('refund') ? 'REFUND_REQUEST' : (t.includes('cancel') ? 'CANCELLATION' : 'DELIVERY_ENQUIRY')
    };
  }

  const system = `You extract claimed details. ONLY output JSON matching exact schema: 
  {
    "claimed_name": "<string or null, any names heard>",
    "claimed_intent": "<string or null>"
  }`;
  const user = `Transcript:\n"${transcript}"`;
  return await queryOllama(system, user, true) || {};
}

async function verifyClaims(extracted, orderData) {
  if (config.useMockOllama) {
    await new Promise(r => setTimeout(r, 400));
    const orderFound = !!orderData;
    const nameFound = !!extracted?.claimed_name;
    const isVerified = orderFound && nameFound; // Quick mock strategy
    return {
      is_verified: isVerified,
      verification_checklist: {
        "Order ID Located": orderFound,
        "Name Matches Account": nameFound
      },
      agent_script: isVerified 
          ? "Thank you for verifying your details. Let's look into your issue."
          : (orderFound ? "Could I ask you to confirm your first and last name please?" : "Welcome to GovAI Delivery! Could you please provide your Order ID?")
    };
  }

  const system = `You are a verification AI. Compare claimed details vs database. ONLY output JSON matching exact schema:
  {
    "is_verified": <boolean true/false>,
    "verification_checklist": { "<check item>": <boolean> },
    "agent_script": "<what to instruct the agent to ask next to obtain verification, or a thank you if verified>"
  }`;
  const user = `CLAIMED:\n${JSON.stringify(extracted||{})}\n\nDATABASE:\n${JSON.stringify(orderData||{})}\n\nDetermine if verified based on matching data.`;
  return await queryOllama(system, user, true) || { is_verified: false, verification_checklist: {} };
}

async function assistAgent(transcript, orderData) {
  if (config.useMockOllama) {
    await new Promise(r => setTimeout(r, 400));
    const t = transcript.toLowerCase();
    
    let intent = 'INQUIRY';
    let sentiment = 'NEUTRAL';
    let action = 'PROVIDE_INFO';
    let script = "Let me pull that up for you right away.";
    let flags = [];
    
    if (t.includes('refund')) {
       intent = 'REFUND_REQUEST'; sentiment = 'NEGATIVE'; action = 'ISSUE_REFUND'; 
       script = "I see your order. Let me process this refund right now.";
       flags = ['HIGH_URGENCY'];
    }
    else if (t.includes('cancel')) {
       intent = 'CANCELLATION'; action = 'OFFER_RETENTION';
       script = "Before you cancel, I'd love to offer 20% off.";
    }
    
    return {
      intent, sentiment, confidence: 92, summary: "Customer discussing " + intent,
      flags, agentScript: script, agentAction: action
    };
  }

  const system = `You provide final resolutions for verified users. ONLY output JSON matching exact schema:
  {
    "intent": "REFUND_REQUEST|DELIVERY_ENQUIRY|CANCELLATION|COMPLAINT|INQUIRY|NONE",
    "sentiment": "POSITIVE|NEUTRAL|NEGATIVE|VERY_NEGATIVE",
    "summary": "<1-2 sentences>",
    "flags": ["PROFANITY","HIGH_URGENCY","ESCALATION_NEEDED","LEGAL_THREAT","POLICY_VIOLATION"],
    "confidence": <integer 0-100>,
    "agentScript": "suggested string to say to user",
    "agentAction": "ISSUE_REFUND|OFFER_RETENTION|ESCALATE|EMPATHIZE|PROVIDE_INFO|NONE"
  }`;
  const user = `Transcript: "${transcript}"\nOrder Data: ${JSON.stringify(orderData||{})}`;
  return await queryOllama(system, user, true) || { intent: "NONE", sentiment: "NEUTRAL", agentAction: "NONE", confidence: 0 };
}

module.exports = { extractClaims, verifyClaims, assistAgent };
