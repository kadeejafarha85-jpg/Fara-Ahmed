// src/services/agentPromptService.js
// Verification-aware prompt pipeline for live agent assist.
// Flow: UNVERIFIED → verify user → VERIFIED → answer question in context of their order

const logger = require('../utils/logger');

// ─── VERIFICATION STAGES ──────────────────────────────────────────────────────
const VERIFICATION_STAGE = {
  UNVERIFIED:          'UNVERIFIED',           // call just started
  AWAITING_NAME:       'AWAITING_NAME',        // agent asked for name
  AWAITING_ORDER:      'AWAITING_ORDER',       // agent asked for order ID
  AWAITING_EMAIL:      'AWAITING_EMAIL',       // agent asked for email
  PARTIALLY_VERIFIED:  'PARTIALLY_VERIFIED',  // 1 of 2 checks passed
  VERIFIED:            'VERIFIED',             // identity confirmed
  FAILED:              'FAILED',               // too many mismatches
};

// ─── SYSTEM PERSONA ───────────────────────────────────────────────────────────
const SYSTEM_PERSONA = `You are an AI Call Logging and Agent Assistance System.
Your job is to capture every user interaction, maintain an accurate call log, and ensure structured, consistent responses for downstream systems.

📌 CORE OBJECTIVES
- Log every user input
- Update call session state continuously
- Store structured data into database
- Fix incomplete or inconsistent inputs before responding
- Generate clean agent-ready outputs for UI and backend

👉 Every response must prioritize Data integrity, Traceability, Structured logging, and Backend compatibility.`;

// ─── PROMPT BUILDERS ─────────────────────────────────────────────────────────

/**
 * Step 1 — Verification prompt.
 * Used when the customer has not yet been verified.
 * Tells the LLM what the customer said and what data we have on file,
 * and asks it to decide if the provided info matches.
 */
function buildVerificationPrompt({ transcript, customerSaid, orderOnFile }) {
  return `${SYSTEM_PERSONA}

## CURRENT SITUATION
The customer is NOT yet verified. The agent must confirm identity before proceeding.

## WHAT THE CUSTOMER JUST SAID
"${transcript}"

## WHAT THE CUSTOMER CLAIMED (extracted from transcript)
${JSON.stringify(customerSaid, null, 2)}

## WHAT IS ON FILE IN THE DATABASE
${JSON.stringify(orderOnFile, null, 2)}

## YOUR TASK
1. Compare what the customer claimed against what is on file.
2. Determine if the verification attempt PASSED, PARTIAL, or FAILED.
3. Tell the agent exactly what to say next.
4. If verification passed, tell the agent to proceed.
5. If it failed or is partial, tell the agent what to ask next.

Respond ONLY with this JSON (no markdown, no extra text):
{
  "verificationResult": "PASSED" | "PARTIAL" | "FAILED",
  "matchedFields": ["name" | "email" | "orderId" | "phone"],
  "mismatchedFields": ["name" | "email" | "orderId" | "phone"],
  "confidenceScore": <0.0 to 1.0>,
  "agentScript": "<exact words the agent should say now>",
  "nextVerificationStep": "ASK_ORDER_ID" | "ASK_EMAIL" | "ASK_NAME" | "ASK_PHONE" | "PROCEED" | "REJECT",
  "reasoning": "<brief internal reasoning — not shown to customer>"
}`;
}

/**
 * Step 2 — Post-verification response prompt.
 * Used once verification is VERIFIED.
 * LLM gets the full order context and the customer's question/intent.
 */
function buildResponsePrompt({ transcript, intent, sentiment, order, conversationHistory }) {
  const orderContext = order ? `
## VERIFIED CUSTOMER ORDER
- Order ID:        ${order.orderId}
- Customer Name:   ${order.customer.name}
- Products:        ${order.products.map(p => `${p.name} x${p.quantity} (AED ${p.totalPrice})`).join(', ')}
- Order Total:     AED ${order.orderTotal}
- Payment Status:  ${order.payment.status} via ${order.payment.method}
- Delivery Status: ${order.delivery.status}
- Carrier:         ${order.delivery.carrier} · Tracking: ${order.delivery.trackingNo}
- Est. Delivery:   ${order.delivery.estimatedDate ? new Date(order.delivery.estimatedDate).toDateString() : 'N/A'}
- Delivered At:    ${order.delivery.deliveredAt ? new Date(order.delivery.deliveredAt).toDateString() : 'Not yet'}
` : '## ORDER\nNo order data found for this customer.';

  const historyContext = conversationHistory?.length
    ? `\n## CONVERSATION HISTORY\n${conversationHistory.map(h => `[${h.role}]: ${h.text}`).join('\n')}`
    : '';

  return `${SYSTEM_PERSONA}

## VERIFICATION STATUS: ✅ VERIFIED

${orderContext}
${historyContext}

## WHAT THE CUSTOMER JUST SAID
"${transcript}"

## DETECTED INTENT:   ${intent ?? 'UNKNOWN'}
## DETECTED SENTIMENT: ${sentiment ?? 'NEUTRAL'}

## YOUR TASK
Based on the verified customer's order data and what they just said:
1. Decide what action the agent should take.
2. Write the exact script for the agent to say.
3. Flag any governance issues if present.
4. Suggest any backend actions the system should trigger.

Respond ONLY with this JSON (no markdown, no extra text):
{
  "intent": "REFUND_REQUEST" | "CANCELLATION" | "DELIVERY_ENQUIRY" | "COMPLAINT" | "BILLING" | "TECHNICAL" | "INQUIRY" | "OTHER",
  "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "VERY_NEGATIVE",
  "confidence": <0.0 to 1.0>,
  "summary": "<1–2 sentence summary of the issue>",
  "agentScript": "<exact empathetic response the agent should say>",
  "agentAction": "ISSUE_REFUND" | "OFFER_RETENTION" | "ESCALATE" | "PROVIDE_TRACKING" | "UPDATE_ADDRESS" | "EMPATHIZE" | "PROVIDE_INFO" | "NONE",
  "actionPayload": {
    "orderId": "<orderId if relevant>",
    "reason": "<reason for action>"
  },
  "flags": ["HIGH_URGENCY" | "LEGAL_THREAT" | "ESCALATION_NEEDED" | "PROFANITY" | "POLICY_VIOLATION"],
  "governance": {
    "piiDetected": <true|false>,
    "complianceNote": "<any compliance issue or null>"
  }
}`;
}

/**
 * Step 0 — Extraction prompt.
 * Runs first on every new transcript chunk.
 * Extracts what the customer is claiming (name, order ID, email) from raw speech.
 */
function buildExtractionPrompt(transcript) {
  return `${SYSTEM_PERSONA}

A customer is speaking on a live call. Extract any identity or order information they mention.

Transcript: "${transcript.replace(/"/g, '\\"')}"

Respond ONLY with this JSON (use null for fields not mentioned):
{
  "raw_input": "${transcript.replace(/"/g, '\\"')}",
  "cleaned_input": "<fix broken sentences, missing words, or unclear phrases>",
  "intent": "<the core question or request the customer is making>",
  "entities": {
    "order_id": "<order ID like ORD-2024-xxxxx or null>",
    "email": "<email address or null>",
    "phone": "<phone number or null>",
    "name": "<full name or null>"
  },
  "sentiment": "neutral | angry | happy | frustrated",
  "confidence": <0.0 to 1.0>
}`;
}

// ─── MAIN SERVICE ─────────────────────────────────────────────────────────────

/**
 * Full pipeline:
 * 1. Extract claimed identity from transcript
 * 2. If not verified → run verification prompt → return verification guidance
 * 3. If verified     → run response prompt    → return agent assist response
 *
 * @param {object} params
 * @param {string}  params.transcript          - Latest full transcript text
 * @param {string}  params.verificationStage   - Current VERIFICATION_STAGE value
 * @param {object}  params.orderOnFile         - Order/user record from MongoDB (or null)
 * @param {object}  params.conversationHistory - Array of { role, text } prior turns
 * @param {string}  params.ollamaUrl           - Ollama API base URL
 * @param {string}  params.ollamaModel         - Model name e.g. 'llama3.2'
 */
async function runAgentPromptPipeline({
  transcript,
  verificationStage,
  orderOnFile,
  conversationHistory = [],
  ollamaUrl,
  ollamaModel,
}) {
  // ── Step 0: Extract what the customer is claiming ─────────────────────────
  let extracted = {};
  try {
    const raw = await callOllama(ollamaUrl, ollamaModel, buildExtractionPrompt(transcript));
    extracted = parseJSON(raw) ?? {};
    logger.debug('Extraction result', extracted);
  } catch (err) {
    logger.warn('Extraction step failed', { error: err.message });
  }

  // ── Step 1: Verification (if not yet verified) ────────────────────────────
  if (verificationStage !== VERIFICATION_STAGE.VERIFIED) {
    const customerSaid = {
      name:    extracted.entities?.name,
      orderId: extracted.entities?.order_id,
      email:   extracted.entities?.email,
      phone:   extracted.entities?.phone,
    };

    // If we have nothing to verify yet — ask the agent to collect info
    const hasAnyClaim = Object.values(customerSaid).some(v => v !== null && v !== undefined);
    if (!hasAnyClaim) {
      return {
        type:              'VERIFICATION_NEEDED',
        verificationStage: VERIFICATION_STAGE.AWAITING_NAME,
        agentScript:       "Thank you for calling. To get started, could you please confirm your full name and order number?",
        extracted,
      };
    }

    // Run LLM verification
    try {
      const raw    = await callOllama(ollamaUrl, ollamaModel, buildVerificationPrompt({
        transcript,
        customerSaid,
        orderOnFile: orderOnFile ? sanitizeOrderForVerification(orderOnFile) : null,
      }));
      const result = parseJSON(raw);
      if (!result) throw new Error('Invalid verification JSON from Ollama');

      const nextStage = result.verificationResult === 'PASSED'
        ? VERIFICATION_STAGE.VERIFIED
        : result.verificationResult === 'FAILED'
          ? VERIFICATION_STAGE.FAILED
          : VERIFICATION_STAGE.PARTIALLY_VERIFIED;

      return {
        type:              'VERIFICATION_RESPONSE',
        verificationStage: nextStage,
        verificationResult: result.verificationResult,
        matchedFields:     result.matchedFields,
        mismatchedFields:  result.mismatchedFields,
        confidenceScore:   result.confidenceScore,
        agentScript:       result.agentScript,
        nextStep:          result.nextVerificationStep,
        reasoning:         result.reasoning,
        extracted,
      };
    } catch (err) {
      logger.error('Verification LLM call failed', { error: err.message });
      return {
        type:              'VERIFICATION_ERROR',
        verificationStage: VERIFICATION_STAGE.UNVERIFIED,
        agentScript:       "I'm having trouble processing that. Could you repeat your name and order number?",
        extracted,
      };
    }
  }

  // ── Step 2: Verified — run full response prompt ───────────────────────────
  try {
    const raw    = await callOllama(ollamaUrl, ollamaModel, buildResponsePrompt({
      transcript,
      intent:              extracted.intent,
      sentiment:           null, // populated by caller if available
      order:               orderOnFile,
      conversationHistory,
    }));
    const result = parseJSON(raw);
    if (!result) throw new Error('Invalid response JSON from Ollama');

    return {
      type:              'AGENT_ASSIST',
      verificationStage: VERIFICATION_STAGE.VERIFIED,
      ...result,
      extracted,
    };
  } catch (err) {
    logger.error('Agent assist LLM call failed', { error: err.message });
    return {
      type:              'AGENT_ASSIST_ERROR',
      verificationStage: VERIFICATION_STAGE.VERIFIED,
      agentScript:       "Please give me one moment while I look into that for you.",
      extracted,
    };
  }
}

// ─── INTERNAL UTILS ───────────────────────────────────────────────────────────

async function callOllama(baseUrl, model, prompt) {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, prompt, stream: false }),
    signal:  AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.response ?? '';
}

function parseJSON(raw) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Only expose fields needed for verification — never send full order to LLM
 * if it could leak data before the customer is confirmed.
 */
function sanitizeOrderForVerification(order) {
  return {
    name:    order.customer?.name    ?? null,
    email:   order.customer?.email   ?? null,
    phone:   order.customer?.phone   ?? null,
    orderId: order.orderId            ?? null,
    city:    order.customer?.city    ?? null,
  };
}

module.exports = {
  runAgentPromptPipeline,
  buildVerificationPrompt,
  buildResponsePrompt,
  buildExtractionPrompt,
  VERIFICATION_STAGE,
};
