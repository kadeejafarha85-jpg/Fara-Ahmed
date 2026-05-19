// src/services/bedrockService.js
// Sends transcripts to Amazon Bedrock (Claude model) for:
//   • Intent detection
//   • Entity extraction
//   • Summarization
// Returns structured JSON matching a strict schema.
// Mock mode returns realistic deterministic output.

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const config  = require('../config');
const logger  = require('../utils/logger');
const { withRetry } = require('../utils/retry');

// ─── Real client ─────────────────────────────────────────────
let bedrockClient = null;
function getClient() {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: config.aws.region,
      credentials: config.aws.accessKeyId
        ? { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey }
        : undefined,
    });
  }
  return bedrockClient;
}

// ─── Prompt engineering ──────────────────────────────────────
/**
 * Build the system + user prompt sent to Claude on Bedrock.
 * The model is instructed to return ONLY valid JSON — no commentary.
 */
function buildPrompt(transcript) {
  const systemPrompt = `You are a call-centre AI analyst for a delivery and e-commerce company.
Your job is to extract structured data from customer call transcripts.

You MUST return ONLY valid JSON — no prose, no markdown fences, no explanation.
The JSON must match this exact schema:
{
  "intent": "<one of: CHANGE_ADDRESS | REFUND_REQUEST | DELIVERY_ENQUIRY | CANCELLATION | COMPLAINT | PRODUCT_QUERY | COMPLIMENT | OTHER>",
  "entities": {
    "order_id":   "<string or null>",
    "new_address":"<string or null>",
    "phone":      "<string or null>",
    "email":      "<string or null>",
    "customer_name":"<string or null>",
    "amount":     "<string or null>"
  },
  "summary":     "<2-3 sentence summary of the call>",
  "confidence":  <integer 0-100>,
  "sentiment":   "<POSITIVE | NEUTRAL | NEGATIVE>",
  "urgency":     "<LOW | MEDIUM | HIGH>"
}`;

  const userPrompt = `Analyse this customer call transcript:\n\n"${transcript}"\n\nReturn ONLY the JSON object.`;

  return { systemPrompt, userPrompt };
}

// ─── Mock implementation ─────────────────────────────────────
/**
 * Deterministic mock: maps known keywords to realistic Bedrock output.
 */
async function mockAnalyze(transcript) {
  logger.debug('[MOCK Bedrock] Simulating NLP analysis');
  await new Promise(r => setTimeout(r, 600));

  const t = transcript.toLowerCase();

  let intent     = 'OTHER';
  let confidence = 75;
  let sentiment  = 'NEUTRAL';
  let urgency    = 'MEDIUM';
  let entities   = { order_id: null, new_address: null, phone: null, email: null, customer_name: null, amount: null };

  // Intent detection
  if (t.includes('address') || t.includes('change') || t.includes('update')) {
    intent = 'CHANGE_ADDRESS'; confidence = 87; sentiment = 'NEUTRAL';
  } else if (t.includes('refund') || t.includes('money back') || t.includes('charge')) {
    intent = 'REFUND_REQUEST'; confidence = 82; sentiment = 'NEGATIVE'; urgency = 'HIGH';
  } else if (t.includes('status') || t.includes('where') || t.includes('tracking') || t.includes('arrived')) {
    intent = 'DELIVERY_ENQUIRY'; confidence = 91; sentiment = 'NEUTRAL';
  } else if (t.includes('cancel') || t.includes('subscription')) {
    intent = 'CANCELLATION'; confidence = 69; sentiment = 'NEGATIVE';
  } else if (t.includes('ridiculous') || t.includes('garbage') || t.includes('sue') || t.includes('unacceptable')) {
    intent = 'COMPLAINT'; confidence = 95; sentiment = 'NEGATIVE'; urgency = 'HIGH';
  }

  // Entity extraction (regex)
  const orderMatch   = transcript.match(/order\s(?:number\s)?(\d{4,6})/i);
  const phoneMatch   = transcript.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,3}\s?\d{3,})/);
  const emailMatch   = transcript.match(/[\w.-]+@[\w.-]+\.\w+/i);
  const addrMatch    = transcript.match(/\d+\s[\w\s,]+(?:road|street|avenue|tower|marina|jumeirah|dubai)[^,.]*/i);
  const amountMatch  = transcript.match(/\$[\d,]+|\d+\s?(?:dollars|AED|usd)/i);

  if (orderMatch)  entities.order_id    = orderMatch[1];
  if (phoneMatch)  entities.phone       = phoneMatch[0];
  if (emailMatch)  entities.email       = emailMatch[0];
  if (addrMatch)   entities.new_address = addrMatch[0].trim();
  if (amountMatch) entities.amount      = amountMatch[0];

  const summary = `Customer called regarding ${intent.replace('_', ' ').toLowerCase()}. `
    + (entities.order_id ? `Referenced order #${entities.order_id}. ` : '')
    + `Sentiment is ${sentiment.toLowerCase()} with ${urgency.toLowerCase()} urgency.`;

  return { intent, entities, summary, confidence, sentiment, urgency };
}

// ─── Real Bedrock invocation ──────────────────────────────────
async function realAnalyze(transcript) {
  const { systemPrompt, userPrompt } = buildPrompt(transcript);
  return invokeBedrockJson({ systemPrompt, userPrompt, maxTokens: 512 });
}

async function invokeBedrockJson({
  systemPrompt,
  userPrompt,
  maxTokens = 800,
  temperature = 0.1,
  operation = 'Bedrock InvokeModel',
}) {
  const client = getClient();

  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt },
    ],
  };

  const response = await withRetry(
    () => client.send(new InvokeModelCommand({
      modelId: config.aws.bedrockModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    })),
    config.retry.maxRetries,
    config.retry.delayMs,
    operation
  );

  const raw = Buffer.from(response.body).toString('utf-8');
  const body = JSON.parse(raw);
  const text = body.content?.[0]?.text || '';

  logger.debug('Bedrock raw response', { operation, length: text.length });

  try {
    return JSON.parse(text.trim());
  } catch {
    const jsonMatch = text.match(/\{[\s\S]+\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error('Bedrock returned non-JSON response: ' + text.slice(0, 200));
  }
}

/**
 * Analyse a transcript using Bedrock (real) or mock.
 * @param {string} transcript
 * @returns {Promise<{intent, entities, summary, confidence, sentiment, urgency}>}
 */
async function analyzeTranscript(transcript) {
  if (!transcript || transcript.trim().length < 10) {
    return { intent: 'UNKNOWN', entities: {}, summary: 'No transcript provided.', confidence: 0, sentiment: 'NEUTRAL', urgency: 'LOW' };
  }

  if (config.useMockAws) return mockAnalyze(transcript);

  try {
    return await realAnalyze(transcript);
  } catch (err) {
    logger.error('Bedrock analysis failed', { error: err.message });
    throw err;
  }
}

module.exports = { analyzeTranscript, invokeBedrockJson };
