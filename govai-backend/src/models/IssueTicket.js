const mongoose = require('mongoose');

const IssueTicketSchema = new mongoose.Schema({
  ticket_id: { type: String, required: true, unique: true, index: true },
  call_id: { type: String, index: true },
  order_id: { type: String, index: true },
  customer_id: { type: String, index: true },
  customer: {
    name: String,
    email: String,
    phone: String,
  },
  issue_type: {
    type: String,
    enum: [
      'REFUND_REQUEST',
      'CANCELLATION',
      'DELIVERY_ENQUIRY',
      'COMPLAINT',
      'BILLING',
      'TECHNICAL',
      'ADDRESS_CHANGE',
      'ESCALATION',
      'OTHER',
    ],
    default: 'OTHER',
    index: true,
  },
  priority: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
    default: 'MEDIUM',
    index: true,
  },
  status: {
    type: String,
    enum: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'],
    default: 'OPEN',
    index: true,
  },
  summary: String,
  transcript_excerpt: String,
  assigned_team: { type: String, default: 'Customer Support' },
  assigned_agent: String,
  source: { type: String, default: 'LIVE_CALL' },
  verification: {
    stage: String,
    result: String,
    matched_fields: [String],
    confidence_score: Number,
  },
  governance: {
    status: String,
    flags: [String],
    pii_detected: Boolean,
    compliance_note: String,
  },
  action: {
    requested: String,
    payload: mongoose.Schema.Types.Mixed,
  },
  history: [{
    status: String,
    changed_by: String,
    note: String,
    changed_at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

module.exports = mongoose.model('IssueTicket', IssueTicketSchema);
