// src/services/transcribeService.js
// Submits audio to AWS Transcribe for speech-to-text.
// In mock mode returns realistic sample transcripts immediately.

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} = require('@aws-sdk/client-transcribe');
const config = require('../config');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

let transcribeClient = null;

function getClient() {
  if (!transcribeClient) {
    transcribeClient = new TranscribeClient({
      region: config.aws.region,
      credentials: config.aws.accessKeyId
        ? { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey }
        : undefined,
    });
  }
  return transcribeClient;
}

const MOCK_TRANSCRIPTS = [
  {
    text: "Hello, I need to change the delivery address for my order number 88234. The new address is 45 Marina Tower, Dubai Marina, Dubai. My phone number is 050-123-4567. Please update it as soon as possible.",
    intent_hint: 'CHANGE_ADDRESS',
    confidence: 87,
  },
  {
    text: "Hi, I'm calling to check the status of my refund for order 77891. I was charged twice and I want my money back immediately or I'm filing a chargeback!",
    intent_hint: 'REFUND_REQUEST',
    confidence: 72,
  },
  {
    text: "Good morning. I placed order number 55123 last week and it still hasn't arrived. The tracking says it's in transit but I need it by tomorrow for an event.",
    intent_hint: 'DELIVERY_ENQUIRY',
    confidence: 91,
  },
  {
    text: "I want to cancel my subscription. I found a better deal elsewhere. My account email is customer@example.com and my billing address is 12 Al Wasl Road, Jumeirah.",
    intent_hint: 'CANCELLATION',
    confidence: 69,
  },
  {
    text: "This is absolutely ridiculous. Your product is complete garbage. I'm going to sue your company and report you to the consumer authority. This is unacceptable!",
    intent_hint: 'COMPLAINT',
    confidence: 95,
  },
];

async function mockTranscribe(audioKey) {
  logger.debug('[MOCK AWS Transcribe] Simulating transcription', { audioKey });
  await new Promise(resolve => setTimeout(resolve, 800));

  const idx = Math.abs(audioKey.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % MOCK_TRANSCRIPTS.length;
  const sample = MOCK_TRANSCRIPTS[idx];

  return {
    transcript: sample.text,
    confidence: sample.confidence,
    language: config.aws.transcribeLanguageCode,
    job_name: `mock-transcribe-${uuidv4().slice(0, 8)}`,
    mock: true,
  };
}

function mediaFormatFromKey(audioKey) {
  const ext = audioKey.split('.').pop()?.toLowerCase();
  if (['mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm'].includes(ext)) return ext;
  if (ext === 'm4a') return 'mp4';
  return 'wav';
}

async function pollJob(client, jobName, maxAttempts = 60, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await client.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    const job = response.TranscriptionJob;
    const status = job?.TranscriptionJobStatus;

    if (status === 'COMPLETED') {
      const transcriptUri = job.Transcript?.TranscriptFileUri;
      if (!transcriptUri) throw new Error('AWS Transcribe completed without a transcript URI.');

      const transcriptResponse = await axios.get(transcriptUri, { timeout: 30000 });
      const results = transcriptResponse.data?.results;
      const transcript = results?.transcripts?.map(item => item.transcript).join(' ').trim() || '';
      const confidences = (results?.items || [])
        .map(item => Number(item.alternatives?.[0]?.confidence))
        .filter(Number.isFinite);
      const confidence = confidences.length
        ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100)
        : 90;

      return {
        transcript,
        confidence,
        language: job.LanguageCode || config.aws.transcribeLanguageCode,
        job_name: jobName,
      };
    }

    if (status === 'FAILED') {
      throw new Error(job?.FailureReason || 'AWS Transcribe job failed.');
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error(`AWS Transcribe job timed out: ${jobName}`);
}

async function transcribeAudio(audioKey, callId) {
  if (config.useMockAws) return mockTranscribe(audioKey);

  logger.info('Starting AWS Transcribe job', { audioKey });

  const client = getClient();
  const jobName = `govai-${callId}-${uuidv4().slice(0, 8)}`.replace(/[^0-9a-zA-Z._-]/g, '-');
  const mediaUri = `s3://${config.aws.s3Bucket}/${audioKey}`;

  await withRetry(
    () => client.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: config.aws.transcribeLanguageCode,
      MediaFormat: mediaFormatFromKey(audioKey),
      Media: { MediaFileUri: mediaUri },
      OutputBucketName: config.aws.transcribeOutputBucket || config.aws.s3Bucket,
    })),
    config.retry.maxRetries,
    config.retry.delayMs,
    'AWS Transcribe StartTranscriptionJob'
  );

  return pollJob(client, jobName);
}

module.exports = { transcribeAudio };
