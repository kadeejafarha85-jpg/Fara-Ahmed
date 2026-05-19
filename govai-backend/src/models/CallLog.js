const mongoose = require('mongoose');

const PipelineStageSchema = new mongoose.Schema({
  stage: String,
  status: String,
  message: String,
  duration_ms: Number,
  completed_at: Date,
}, { _id: false });

const CallLogSchema = new mongoose.Schema({
  call_id: { type: String, required: true, unique: true, index: true },
  timestamp: { type: Date, default: Date.now },
  agent_id: { type: String, default: 'UNASSIGNED', index: true },
  customer_id: { type: String, index: true },
  order_id: { type: String, index: true },
  issue_ticket_id: { type: String, index: true },
  audio_url: String,
  audio_key: String,
  file_name: String,
  file_size: Number,
  duration_secs: Number,
  transcript: String,
  user_input: { type: String },
  system_processed_input: { type: String },
  intent: { type: String },
  entities: {
    order_id: String,
    email: String,
    phone: String,
    name: String,
  },
  verification: {
    stage: String,
    result: String,
    matched_fields: [String],
    mismatched_fields: [String],
    confidence_score: Number,
    verified_at: Date,
  },
  agent_stage: { type: String },
  status: { type: String },
  notes: { type: String },
  processing_status: {
    type: String,
    enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'QUEUED',
    index: true,
  },
  ai_result: {
    intent: String,
    summary: String,
    confidence: Number,
    sentiment: String,
    agent_action: String,
    action_payload: mongoose.Schema.Types.Mixed,
  },
  governance_result: {
    status: {
      type: String,
      enum: ['APPROVED', 'REVIEW_REQUIRED', 'BLOCKED'],
    },
    governance_score: Number,
    flags: [String],
    masked_transcript: String,
  },
  pipeline_stages: [PipelineStageSchema],
}, { timestamps: true });

module.exports = mongoose.model('CallLog', CallLogSchema);
