const { v4: uuidv4 } = require('uuid');
const IssueTicket = require('../models/IssueTicket');
const Order = require('../models/Order');
const CallLog = require('../models/CallLog');
const logger = require('../utils/logger');

const ACTION_TO_ISSUE = {
  ISSUE_REFUND: 'REFUND_REQUEST',
  OFFER_RETENTION: 'CANCELLATION',
  ESCALATE: 'ESCALATION',
  PROVIDE_TRACKING: 'DELIVERY_ENQUIRY',
  UPDATE_ADDRESS: 'ADDRESS_CHANGE',
  EMPATHIZE: 'COMPLAINT',
  PROVIDE_INFO: 'OTHER',
  NONE: 'OTHER',
};

function priorityFrom({ sentiment, flags = [], verificationStage }) {
  if (flags.includes('LEGAL_THREAT') || flags.includes('ESCALATION_NEEDED')) return 'URGENT';
  if (flags.includes('HIGH_URGENCY') || sentiment === 'VERY_NEGATIVE') return 'HIGH';
  if (verificationStage === 'FAILED') return 'HIGH';
  if (sentiment === 'NEGATIVE') return 'MEDIUM';
  return 'LOW';
}

function shouldCreateTicket(result = {}) {
  const action = result.agentAction;
  if (!action || action === 'NONE' || action === 'PROVIDE_INFO') return false;
  return true;
}

async function initiateIssueTicket({
  callId,
  order,
  transcript,
  result,
  source = 'LIVE_CALL',
}) {
  if (!shouldCreateTicket(result)) return null;

  const orderId = result.actionPayload?.orderId || order?.orderId || result.extracted?.entities?.order_id || null;
  const ticketId = `TCK-${uuidv4().slice(0, 8).toUpperCase()}`;
  const issueType = ACTION_TO_ISSUE[result.agentAction] || result.intent || 'OTHER';
  const flags = result.flags || [];
  const priority = priorityFrom({
    sentiment: result.sentiment,
    flags,
    verificationStage: result.verificationStage,
  });
  const existing = await IssueTicket.findOne({
    call_id: callId,
    order_id: orderId,
    issue_type: issueType,
    status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] },
  });

  const ticket = await IssueTicket.findOneAndUpdate(
    { call_id: callId, order_id: orderId, issue_type: issueType, status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] } },
    {
      $setOnInsert: {
        ticket_id: ticketId,
        call_id: callId,
        order_id: orderId,
        customer_id: order?.customer?.customerId || order?.customer?.email || order?.customer?.phone || null,
        customer: {
          name: order?.customer?.name || result.extracted?.entities?.name || null,
          email: order?.customer?.email || result.extracted?.entities?.email || null,
          phone: order?.customer?.phone || result.extracted?.entities?.phone || null,
        },
        issue_type: issueType,
        source,
        history: [{
          status: 'OPEN',
          changed_by: 'SYSTEM',
          note: `Auto-created from ${source.toLowerCase()} ${callId}`,
        }],
      },
      summary: result.summary || result.actionPayload?.reason || 'Customer issue captured from live call.',
      transcript_excerpt: transcript?.slice(-1000),
      priority,
      assigned_team: priority === 'URGENT' ? 'Escalations' : issueType === 'BILLING' || issueType === 'REFUND_REQUEST' ? 'Billing Support' : 'Customer Support',
      verification: {
        stage: result.verificationStage,
        result: result.verificationResult,
        matched_fields: result.matchedFields || [],
        confidence_score: result.confidenceScore || result.confidence || null,
      },
      governance: {
        status: flags.length ? 'REVIEW_REQUIRED' : 'APPROVED',
        flags,
        pii_detected: result.governance?.piiDetected ?? null,
        compliance_note: result.governance?.complianceNote ?? null,
      },
      action: {
        requested: result.agentAction,
        payload: result.actionPayload || {},
      },
    },
    { upsert: true, new: true }
  );

  if (orderId && !existing) {
    await Order.updateOne(
      { orderId },
      {
        $set: {
          'issueSummary.lastTicketId': ticket.ticket_id,
          'issueSummary.lastIssueType': issueType,
        },
        $inc: { 'issueSummary.openTickets': 1 },
      }
    );
  }

  await CallLog.updateOne(
    { call_id: callId },
    { $set: { issue_ticket_id: ticket.ticket_id } }
  );

  logger.info('Issue ticket initiated', { ticketId: ticket.ticket_id, callId, orderId, issueType });
  return ticket;
}

module.exports = {
  initiateIssueTicket,
  shouldCreateTicket,
};
