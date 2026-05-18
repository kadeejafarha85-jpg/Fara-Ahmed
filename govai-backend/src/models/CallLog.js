const mongoose = require('mongoose');

const CallLogSchema = new mongoose.Schema({
  call_id: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  user_input: { type: String },
  system_processed_input: { type: String },
  intent: { type: String },
  entities: {
    order_id: String,
    email: String,
    phone: String,
    name: String,
  },
  agent_stage: { type: String },
  status: { type: String },
  notes: { type: String }
});

module.exports = mongoose.model('CallLog', CallLogSchema);
