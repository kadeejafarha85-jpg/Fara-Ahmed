// src/services/agentPromptService.js
// Verification-aware live agent assist powered by Amazon Bedrock.

const config = require('../config');
const logger = require('../utils/logger');
const { invokeBedrockJson } = require('./bedrockService');

const VERIFICATION_STAGE = {
  UNVERIFIED: 'UNVERIFIED',
  AWAITING_NAME: 'AWAITING_NAME',
  AWAITING_ORDER: 'AWAITING_ORDER',
  AWAITING_EMAIL: 'AWAITING_EMAIL',
  PARTIALLY_VERIFIED: 'PARTIALLY_VERIFIED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
};

const SYSTEM_PROMPT = `You are a live call-center agent assist system for an e-commerce delivery company.
You receive partial live transcripts and sanitized MongoDB order/customer records.

Critical rules:
- First verify the caller before sharing order, payment, address, tracking, or account details.
- Use the database records only for matching and verification. Never reveal candidate customer data before verification passes.
- If the caller has not supplied enough identity information, ask for the minimum next verification field.
- Return only valid JSON matching the requested schema. No markdown, no prose outside JSON.`;

function buildExtractionPrompt(transcript) {
  return `Extract identity, order, and intent signals from this live call transcript.

Transcript:
"${escapePrompt(transcript)}"

Return only this JSON:
{
  "raw_input": "<original transcript>",
  "cleaned_input": "<cleaned transcript>",
  "intent": "DELIVERY_ENQUIRY | REFUND_REQUEST | CHANGE_ADDRESS | CANCELLATION | COMPLAINT | PRODUCT_QUERY | OTHER",
  "entities": {
    "order_id": "<order id or null>",
    "email": "<email or null>",
    "phone": "<phone or null>",
    "name": "<full name or null>"
  },
  "sentiment": "POSITIVE | NEUTRAL | NEGATIVE | VERY_NEGATIVE",
  "confidence": <0.0 to 1.0>
}`;
}

function buildVerificationPrompt({ transcript, customerSaid, orderOnFile, verificationCandidates }) {
  const dbContext = {
    exactCandidate: orderOnFile ? sanitizeOrderForVerification(orderOnFile) : null,
    candidateList: (verificationCandidates || []).map(sanitizeOrderForVerification),
  };

  return `Initial verification step for a live call.

The caller is NOT verified yet. Compare what the caller said against the sanitized MongoDB customer/order records below.

Caller transcript:
"${escapePrompt(transcript)}"

Caller supplied fields:
${JSON.stringify(customerSaid, null, 2)}

Sanitized MongoDB verification records:
${JSON.stringify(dbContext, null, 2)}

Verification policy:
- PASSED only if at least two reliable fields match the same database record, or orderId plus one customer field match.
- PARTIAL if one reliable field matches or the likely customer/order is found but more proof is needed.
- FAILED only if the caller supplied fields that clearly contradict the same database record.
- If not enough data is supplied, ask for full name and order number first. If one is already supplied, ask for phone or email.
- Do not reveal any database values in agentScript unless verificationResult is PASSED.

Return only this JSON:
{
  "verificationResult": "PASSED | PARTIAL | FAILED",
  "selectedOrderId": "<matched order id or null>",
  "matchedFields": ["name", "email", "orderId", "phone"],
  "mismatchedFields": ["name", "email", "orderId", "phone"],
  "confidenceScore": <0.0 to 1.0>,
  "agentScript": "<exact words the agent should say next>",
  "nextVerificationStep": "ASK_ORDER_ID | ASK_EMAIL | ASK_NAME | ASK_PHONE | PROCEED | REJECT",
  "reasoning": "<brief internal reason>"
}`;
}

function buildResponsePrompt({ transcript, intent, sentiment, order, conversationHistory }) {
  const orderContext = order ? {
    orderId: order.orderId,
    customerName: order.customer?.name,
    products: (order.products || []).map(p => ({
      name: p.name,
      quantity: p.quantity,
      totalPrice: p.totalPrice,
    })),
    orderTotal: order.orderTotal,
    paymentStatus: order.payment?.status,
    delivery: {
      status: order.delivery?.status,
      carrier: order.delivery?.carrier,
      trackingNo: order.delivery?.trackingNo,
      currentAddress: order.delivery?.currentAddress,
      deliverySlot: order.delivery?.deliverySlot,
      estimatedDate: order.delivery?.estimatedDate,
      deliveredAt: order.delivery?.deliveredAt,
    },
  } : null;

  return `The caller is verified. Provide agent assist using the verified order context.

Verified order context:
${JSON.stringify(orderContext, null, 2)}

Conversation history:
${JSON.stringify(conversationHistory || [], null, 2)}

Latest transcript:
"${escapePrompt(transcript)}"

Detected intent: ${intent || 'OTHER'}
Detected sentiment: ${sentiment || 'NEUTRAL'}

Return only this JSON:
{
  "intent": "REFUND_REQUEST | CANCELLATION | DELIVERY_ENQUIRY | COMPLAINT | BILLING | TECHNICAL | INQUIRY | OTHER",
  "sentiment": "POSITIVE | NEUTRAL | NEGATIVE | VERY_NEGATIVE",
  "confidence": <0.0 to 1.0>,
  "summary": "<1-2 sentence issue summary>",
  "agentScript": "<exact response the agent should say>",
  "agentAction": "ISSUE_REFUND | OFFER_RETENTION | ESCALATE | PROVIDE_TRACKING | UPDATE_ADDRESS | EMPATHIZE | PROVIDE_INFO | NONE",
  "actionPayload": {
    "orderId": "<order id if relevant>",
    "reason": "<reason>"
  },
  "flags": ["HIGH_URGENCY", "LEGAL_THREAT", "ESCALATION_NEEDED", "PROFANITY", "POLICY_VIOLATION"],
  "governance": {
    "piiDetected": <true|false>,
    "complianceNote": "<note or null>"
  }
}`;
}

async function runAgentPromptPipeline({
  transcript,
  verificationStage,
  orderOnFile,
  verificationCandidates = [],
  conversationHistory = [],
}) {
  let extracted = {};

  try {
    extracted = await runBedrockJson(
      'Bedrock Live Extraction',
      buildExtractionPrompt(transcript),
      () => mockExtract(transcript)
    );
    logger.debug('Bedrock extraction result', extracted);
  } catch (err) {
    logger.warn('Bedrock extraction step failed', { error: err.message });
    extracted = mockExtract(transcript);
  }

  if (verificationStage !== VERIFICATION_STAGE.VERIFIED) {
    const customerSaid = {
      name: extracted.entities?.name ?? null,
      orderId: extracted.entities?.order_id ?? null,
      email: extracted.entities?.email ?? null,
      phone: extracted.entities?.phone ?? null,
    };

    const hasAnyClaim = Object.values(customerSaid).some(v => v !== null && v !== undefined && v !== '');
    if (!hasAnyClaim) {
      return {
        type: 'VERIFICATION_NEEDED',
        verificationStage: VERIFICATION_STAGE.AWAITING_NAME,
        agentScript: 'I can help with that. For security, could you please confirm your full name and order number?',
        nextStep: 'ASK_NAME',
        extracted,
      };
    }

    try {
      const verification = await runBedrockJson(
        'Bedrock Live Verification',
        buildVerificationPrompt({
          transcript,
          customerSaid,
          orderOnFile,
          verificationCandidates,
        }),
        () => mockVerify(customerSaid, orderOnFile, verificationCandidates)
      );

      const nextStage = verification.verificationResult === 'PASSED'
        ? VERIFICATION_STAGE.VERIFIED
        : verification.verificationResult === 'FAILED'
          ? VERIFICATION_STAGE.FAILED
          : VERIFICATION_STAGE.PARTIALLY_VERIFIED;

      return {
        type: 'VERIFICATION_RESPONSE',
        verificationStage: nextStage,
        verificationResult: verification.verificationResult,
        selectedOrderId: verification.selectedOrderId || null,
        matchedFields: verification.matchedFields || [],
        mismatchedFields: verification.mismatchedFields || [],
        confidenceScore: verification.confidenceScore ?? 0,
        agentScript: verification.agentScript,
        nextStep: verification.nextVerificationStep,
        reasoning: verification.reasoning,
        extracted,
      };
    } catch (err) {
      logger.error('Bedrock verification call failed', { error: err.message });
      const verification = mockVerify(customerSaid, orderOnFile, verificationCandidates);
      const nextStage = verification.verificationResult === 'PASSED'
        ? VERIFICATION_STAGE.VERIFIED
        : verification.verificationResult === 'FAILED'
          ? VERIFICATION_STAGE.FAILED
          : VERIFICATION_STAGE.PARTIALLY_VERIFIED;

      return {
        type: 'VERIFICATION_RESPONSE',
        verificationStage: nextStage,
        verificationResult: verification.verificationResult,
        selectedOrderId: verification.selectedOrderId || null,
        matchedFields: verification.matchedFields || [],
        mismatchedFields: verification.mismatchedFields || [],
        confidenceScore: verification.confidenceScore ?? 0,
        agentScript: verification.agentScript,
        nextStep: verification.nextVerificationStep,
        reasoning: verification.reasoning,
        extracted,
      };
    }
  }

  try {
    const response = await runBedrockJson(
      'Bedrock Live Agent Assist',
      buildResponsePrompt({
        transcript,
        intent: extracted.intent,
        sentiment: extracted.sentiment,
        order: orderOnFile,
        conversationHistory,
      }),
      () => mockResponse(transcript, extracted, orderOnFile)
    );

    return {
      type: 'AGENT_ASSIST',
      verificationStage: VERIFICATION_STAGE.VERIFIED,
      ...response,
      extracted,
    };
  } catch (err) {
    logger.error('Bedrock agent assist call failed', { error: err.message });
    return {
      type: 'AGENT_ASSIST',
      verificationStage: VERIFICATION_STAGE.VERIFIED,
      ...mockResponse(transcript, extracted, orderOnFile),
      extracted,
    };
  }
}

async function runBedrockJson(operation, userPrompt, mockFactory) {
  if (config.useMockAws) return mockFactory();
  return invokeBedrockJson({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 900,
    temperature: 0.1,
    operation,
  });
}

function mockExtract(transcript) {
  const t = transcript.toLowerCase();
  const orderMatch = transcript.match(/ORD-\d{4}-\d{5}/i) || transcript.match(/order\s(?:number\s)?([A-Z0-9-]*\d[A-Z0-9-]*)/i);
  const emailMatch = transcript.match(/[\w.+-]+@[\w-]+\.\w+/i);
  const phoneMatch = transcript.match(/(?:\+\d[\d\s().-]{7,}\d|0\d{2}[-\s]?\d{3}[-\s]?\d{4})/);
  const nameMatch = transcript.match(/(?:my name is|this is|i am)\s+([a-z][a-z\s.'-]{1,}?)(?=\s+(?:and\s+)?(?:order|phone|email)|$)/i);

  let intent = 'OTHER';
  if (t.includes('where') || t.includes('delivery') || t.includes('tracking') || t.includes('status')) intent = 'DELIVERY_ENQUIRY';
  else if (t.includes('refund') || t.includes('money back')) intent = 'REFUND_REQUEST';
  else if (t.includes('address') || t.includes('change')) intent = 'CHANGE_ADDRESS';
  else if (t.includes('cancel')) intent = 'CANCELLATION';
  else if (t.includes('complaint') || t.includes('angry') || t.includes('sue')) intent = 'COMPLAINT';

  return {
    raw_input: transcript,
    cleaned_input: transcript.trim(),
    intent,
    entities: {
      order_id: orderMatch?.[1] || orderMatch?.[0] || null,
      email: emailMatch?.[0] || null,
      phone: phoneMatch?.[0] || null,
      name: nameMatch?.[1]?.trim() || null,
    },
    sentiment: t.includes('angry') || t.includes('upset') || t.includes('ridiculous') ? 'NEGATIVE' : 'NEUTRAL',
    confidence: 0.72,
  };
}

function mockVerify(customerSaid, orderOnFile, verificationCandidates = []) {
  const candidates = [orderOnFile, ...verificationCandidates].filter(Boolean);
  const selected = candidates.find(order => {
    const safe = sanitizeOrderForVerification(order);
    return matches(customerSaid.orderId, safe.orderId)
      || matches(customerSaid.email, safe.email)
      || matchesPhone(customerSaid.phone, safe.phone)
      || matches(customerSaid.name, safe.name);
  });

  if (!selected) {
    return {
      verificationResult: 'PARTIAL',
      selectedOrderId: null,
      matchedFields: [],
      mismatchedFields: [],
      confidenceScore: 0.25,
      agentScript: 'I can help, but I need to verify the account first. Could you please confirm your order number or the phone number on the order?',
      nextVerificationStep: 'ASK_ORDER_ID',
      reasoning: 'No database candidate matched the supplied fields.',
    };
  }

  const safe = sanitizeOrderForVerification(selected);
  const matchedFields = [];
  if (matches(customerSaid.orderId, safe.orderId)) matchedFields.push('orderId');
  if (matches(customerSaid.email, safe.email)) matchedFields.push('email');
  if (matchesPhone(customerSaid.phone, safe.phone)) matchedFields.push('phone');
  if (matches(customerSaid.name, safe.name)) matchedFields.push('name');

  const passed = matchedFields.length >= 2
    || (matchedFields.includes('orderId') && matchedFields.some(field => field !== 'orderId'));
  return {
    verificationResult: passed ? 'PASSED' : 'PARTIAL',
    selectedOrderId: safe.orderId,
    matchedFields,
    mismatchedFields: [],
    confidenceScore: passed ? 0.9 : 0.55,
    agentScript: passed
      ? 'Thank you, I have verified the account. I can help with the order now.'
      : 'Thanks. Could you also confirm the phone number or email address on the order?',
    nextVerificationStep: passed ? 'PROCEED' : 'ASK_PHONE',
    reasoning: `${matchedFields.length} field(s) matched a MongoDB order candidate.`,
  };
}

function mockResponse(transcript, extracted, order) {
  const orderId = order?.orderId || extracted.entities?.order_id || null;
  const delivery = order?.delivery || {};
  const hasDeliveryQuestion = /where|delivery|tracking|status/i.test(transcript);

  return {
    intent: hasDeliveryQuestion ? 'DELIVERY_ENQUIRY' : extracted.intent || 'OTHER',
    sentiment: extracted.sentiment || 'NEUTRAL',
    confidence: 0.86,
    summary: hasDeliveryQuestion
      ? `Customer is asking for delivery status${orderId ? ` for ${orderId}` : ''}.`
      : 'Customer needs assistance with their order.',
    agentScript: order
      ? `Your order ${order.orderId} is currently ${delivery.status || 'being processed'}${delivery.estimatedDate ? ` and is estimated for ${new Date(delivery.estimatedDate).toDateString()}` : ''}.`
      : 'I can help with that. Please share your order number so I can check the delivery status.',
    agentAction: hasDeliveryQuestion ? 'PROVIDE_TRACKING' : 'PROVIDE_INFO',
    actionPayload: { orderId, reason: 'Live call agent assist' },
    flags: [],
    governance: { piiDetected: false, complianceNote: null },
  };
}

function sanitizeOrderForVerification(order) {
  return {
    orderId: order.orderId ?? null,
    name: order.customer?.name ?? null,
    email: order.customer?.email ?? null,
    phone: order.customer?.phone ?? null,
    alternatePhone: order.customer?.alternatePhone ?? null,
    city: order.customer?.city ?? null,
  };
}

function escapePrompt(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function matches(left, right) {
  if (!left || !right) return false;
  return normalize(left) === normalize(right);
}

function matchesPhone(left, right) {
  if (!left || !right) return false;
  return String(left).replace(/\D/g, '') === String(right).replace(/\D/g, '');
}

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = {
  runAgentPromptPipeline,
  buildVerificationPrompt,
  buildResponsePrompt,
  buildExtractionPrompt,
  VERIFICATION_STAGE,
};
