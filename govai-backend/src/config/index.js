// src/config/index.js
// Central configuration — all env vars parsed and validated here.
// Import this instead of process.env throughout the app.
require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 5000,
    env:  process.env.NODE_ENV || 'development',
  },

  db: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/govai',
  },

  aws: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region:          process.env.AWS_REGION            || 'us-east-1',
    s3Bucket:        process.env.S3_BUCKET_NAME        || 'govai-call-audio',
    bedrockModelId:  process.env.BEDROCK_MODEL_ID      || 'anthropic.claude-3-haiku-20240307-v1:0',
    transcribeLanguageCode: process.env.TRANSCRIBE_LANGUAGE_CODE || 'en-US',
    transcribeOutputBucket: process.env.TRANSCRIBE_OUTPUT_BUCKET || '',
  },

  governance: {
    confidenceThreshold: parseInt(process.env.CONFIDENCE_THRESHOLD, 10) || 80,
  },

  ollama: {
    url:   process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
  },

  retry: {
    maxRetries:  parseInt(process.env.MAX_RETRIES, 10)    || 3,
    delayMs:     parseInt(process.env.RETRY_DELAY_MS, 10) || 1000,
  },

  delivery: {
    webhookUrl: process.env.DELIVERY_WEBHOOK_URL || 'http://localhost:4000/api/ingest',
  },

  // When true, all AWS calls return deterministic mock data.
  // Flip to false (and supply real AWS credentials) for production.
  useMockAws: process.env.USE_MOCK_AWS !== 'false',

  // When true, Ollama inference returns deterministic mock data.
  useMockOllama: process.env.USE_MOCK_OLLAMA !== 'false',
};

module.exports = config;
