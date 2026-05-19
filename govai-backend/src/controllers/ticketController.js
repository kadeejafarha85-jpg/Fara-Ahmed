const IssueTicket = require('../models/IssueTicket');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { initiateIssueTicket } = require('../services/issueTicketService');

async function createTicket(req, res) {
  try {
    const ticket = await initiateIssueTicket({
      callId: req.body.call_id,
      order: req.body.order || null,
      transcript: req.body.transcript || '',
      result: {
        intent: req.body.issue_type || 'OTHER',
        agentAction: req.body.agent_action || 'ESCALATE',
        actionPayload: {
          orderId: req.body.order_id,
          reason: req.body.summary,
        },
        sentiment: req.body.sentiment || 'NEUTRAL',
        summary: req.body.summary,
        flags: req.body.flags || [],
        verificationStage: req.body.verification_stage,
      },
      source: 'API',
    });

    if (!ticket) return ApiResponse.badRequest(res, 'Ticket was not created because no actionable issue was provided.');
    return ApiResponse.created(res, ticket, 'Issue ticket created');
  } catch (err) {
    logger.error('Create issue ticket failed', { error: err.message });
    return ApiResponse.error(res, 'Failed to create issue ticket', err);
  }
}

async function getTickets(req, res) {
  try {
    const { status, priority, order_id, call_id, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (order_id) filter.order_id = order_id;
    if (call_id) filter.call_id = call_id;

    const lim = Math.min(parseInt(limit, 10), 100);
    const skip = (parseInt(page, 10) - 1) * lim;
    const total = await IssueTicket.countDocuments(filter);
    const tickets = await IssueTicket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .select('-__v');

    return ApiResponse.success(res, {
      tickets,
      pagination: { page: parseInt(page, 10), limit: lim, total, pages: Math.ceil(total / lim) },
    });
  } catch (err) {
    return ApiResponse.error(res, 'Failed to retrieve issue tickets', err);
  }
}

async function updateTicket(req, res) {
  try {
    const { ticket_id, status, assigned_agent, note, updated_by = 'API' } = req.body;
    if (!ticket_id) return ApiResponse.badRequest(res, 'ticket_id is required');

    const ticket = await IssueTicket.findOne({ ticket_id });
    if (!ticket) return ApiResponse.notFound(res, `Ticket not found: ${ticket_id}`);

    if (status) ticket.status = status;
    if (assigned_agent) ticket.assigned_agent = assigned_agent;
    ticket.history.push({
      status: status || ticket.status,
      changed_by: updated_by,
      note: note || 'Ticket updated',
    });

    await ticket.save();
    return ApiResponse.success(res, ticket, 'Issue ticket updated');
  } catch (err) {
    return ApiResponse.error(res, 'Failed to update issue ticket', err);
  }
}

module.exports = { createTicket, getTickets, updateTicket };
