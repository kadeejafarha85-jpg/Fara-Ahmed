const mongoose = require('mongoose');
const config = require('./config');
const Order = require('./models/Order');
const CallLog = require('./models/CallLog');
const DeliveryOrder = require('./models/DeliveryOrder');
const IssueTicket = require('./models/IssueTicket');

const now = Date.now();
const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000);
const daysFromNow = (n) => new Date(now + n * 24 * 60 * 60 * 1000);

const customers = [
  {
    customerId: 'CUS-1001',
    name: 'Sarah Mitchell',
    email: 'sarah.mitchell@email.com',
    phone: '050-112-3344',
    alternatePhone: '0501123344',
    address: '45 Marina Tower, Dubai Marina',
    city: 'Dubai',
    emirate: 'Dubai',
  },
  {
    customerId: 'CUS-1002',
    name: 'Priya Sharma',
    email: 'priya.s@email.com',
    phone: '050-778-9900',
    alternatePhone: '0507789900',
    address: '22 Electra Street, Al Markaziyah',
    city: 'Abu Dhabi',
    emirate: 'Abu Dhabi',
  },
  {
    customerId: 'CUS-1003',
    name: 'Mohammed Al Rashid',
    email: 'm.rashid@email.com',
    phone: '054-667-8899',
    alternatePhone: '0546678899',
    address: '101 Jumeirah Beach Road',
    city: 'Dubai',
    emirate: 'Dubai',
  },
  {
    customerId: 'CUS-1004',
    name: 'Fatima Al Zaabi',
    email: 'fatima.z@email.com',
    phone: '056-990-1122',
    alternatePhone: '0569901122',
    address: '14 Zayed Bin Sultan Street',
    city: 'Al Ain',
    emirate: 'Abu Dhabi',
  },
  {
    customerId: 'CUS-1005',
    name: 'Carlos Mendes',
    email: 'carlos.m@email.com',
    phone: '052-001-2233',
    alternatePhone: '0520012233',
    address: '78 Deira, Al Rigga Street',
    city: 'Dubai',
    emirate: 'Dubai',
  },
];

const products = [
  { sku: 'SKU-PHONE-S24', name: 'Samsung Galaxy S24 Ultra', category: 'Electronics', quantity: 1, unitPrice: 4899, totalPrice: 4899 },
  { sku: 'SKU-HOME-AIRFRY', name: 'Philips Air Fryer XXL', category: 'Home Appliances', quantity: 1, unitPrice: 749, totalPrice: 749 },
  { sku: 'SKU-AUDIO-SONYXM5', name: 'Sony WH-1000XM5 Headphones', category: 'Electronics', quantity: 1, unitPrice: 1099, totalPrice: 1099 },
  { sku: 'SKU-FASH-RAYBAN', name: 'Ray-Ban Aviator Sunglasses', category: 'Fashion', quantity: 2, unitPrice: 799, totalPrice: 1598 },
  { sku: 'SKU-KITCHEN-VITAMIX', name: 'Vitamix Blender A2500', category: 'Home Appliances', quantity: 1, unitPrice: 1899, totalPrice: 1899 },
];

const scenarios = [
  {
    orderId: 'ORD-2024-01001',
    customer: customers[0],
    product: products[0],
    payment: { method: 'CREDIT_CARD', status: 'PAID', transactionId: 'TXN-SARAH-1001', paidAt: daysAgo(8) },
    delivery: { status: 'OUT_FOR_DELIVERY', carrier: 'Aramex', trackingNo: 'TRK100100001', estimatedDate: daysFromNow(1), deliveredAt: null },
    call: {
      callId: 'CALL-1001',
      agent: 'Sarah Chen',
      intent: 'DELIVERY_ENQUIRY',
      sentiment: 'NEGATIVE',
      confidence: 88,
      transcript: 'My name is Sarah Mitchell. My order is ORD-2024-01001 and my phone is 050-112-3344. The delivery has not arrived and I need help now.',
      flags: ['HIGH_URGENCY'],
      ticket: true,
      issueType: 'DELIVERY_ENQUIRY',
      agentAction: 'PROVIDE_TRACKING',
      summary: 'Customer verified order and requested urgent delivery status support.',
    },
  },
  {
    orderId: 'ORD-2024-01002',
    customer: customers[1],
    product: products[1],
    payment: { method: 'DEBIT_CARD', status: 'PAID', transactionId: 'TXN-PRIYA-1002', paidAt: daysAgo(6) },
    delivery: { status: 'DELIVERED', carrier: 'DHL Express', trackingNo: 'TRK100200002', estimatedDate: daysAgo(2), deliveredAt: daysAgo(1) },
    call: {
      callId: 'CALL-1002',
      agent: 'James Wright',
      intent: 'REFUND_REQUEST',
      sentiment: 'VERY_NEGATIVE',
      confidence: 82,
      transcript: 'This is Priya Sharma. Order ORD-2024-01002 arrived damaged. My email is priya.s@email.com and I want a refund.',
      flags: ['ESCALATION_NEEDED'],
      ticket: true,
      issueType: 'REFUND_REQUEST',
      agentAction: 'ISSUE_REFUND',
      summary: 'Verified customer reported damaged delivered item and requested refund.',
    },
  },
  {
    orderId: 'ORD-2024-01003',
    customer: customers[2],
    product: products[2],
    payment: { method: 'COD', status: 'PENDING', transactionId: null, paidAt: null },
    delivery: { status: 'SHIPPED', carrier: 'FedEx', trackingNo: 'TRK100300003', estimatedDate: daysFromNow(3), deliveredAt: null },
    call: {
      callId: 'CALL-1003',
      agent: 'Nina Alvarez',
      intent: 'ADDRESS_CHANGE',
      sentiment: 'NEUTRAL',
      confidence: 91,
      transcript: 'Mohammed Al Rashid calling for ORD-2024-01003. Please change my delivery address to 12 Downtown Boulevard Dubai.',
      flags: [],
      ticket: true,
      issueType: 'ADDRESS_CHANGE',
      agentAction: 'UPDATE_ADDRESS',
      summary: 'Verified customer requested delivery address update before delivery.',
    },
  },
  {
    orderId: 'ORD-2024-01004',
    customer: customers[3],
    product: products[3],
    payment: { method: 'WALLET', status: 'PAID', transactionId: 'TXN-FATIMA-1004', paidAt: daysAgo(20) },
    delivery: { status: 'RETURNED', carrier: 'Emirates Post', trackingNo: 'TRK100400004', estimatedDate: daysAgo(8), deliveredAt: null },
    call: {
      callId: 'CALL-1004',
      agent: 'Ryan Park',
      intent: 'COMPLAINT',
      sentiment: 'VERY_NEGATIVE',
      confidence: 76,
      transcript: 'I am Fatima Al Zaabi. My order ORD-2024-01004 was returned without contacting me. I may take legal action.',
      flags: ['LEGAL_THREAT', 'ESCALATION_NEEDED'],
      ticket: true,
      issueType: 'ESCALATION',
      agentAction: 'ESCALATE',
      summary: 'Verified customer threatened legal action after unexplained return.',
    },
  },
  {
    orderId: 'ORD-2024-01005',
    customer: customers[4],
    product: products[4],
    payment: { method: 'CREDIT_CARD', status: 'PAID', transactionId: 'TXN-CARLOS-1005', paidAt: daysAgo(3) },
    delivery: { status: 'PACKED', carrier: 'Fetchr', trackingNo: 'TRK100500005', estimatedDate: daysFromNow(4), deliveredAt: null },
    call: {
      callId: 'CALL-1005',
      agent: 'Sarah Chen',
      intent: 'CANCELLATION',
      sentiment: 'NEUTRAL',
      confidence: 84,
      transcript: 'Carlos Mendes here. The order number is ORD-2024-01005. I want to cancel because I ordered the wrong blender.',
      flags: [],
      ticket: true,
      issueType: 'CANCELLATION',
      agentAction: 'OFFER_RETENTION',
      summary: 'Verified customer requested cancellation before dispatch.',
    },
  },
];

function buildOrder(scenario) {
  const openTickets = scenario.call.ticket ? 1 : 0;
  return {
    orderId: scenario.orderId,
    customer: scenario.customer,
    verification: {
      preferredFields: ['orderId', 'name', 'phone', 'email'],
      lastVerifiedAt: daysAgo(1),
      riskLevel: scenario.call.flags.includes('LEGAL_THREAT') ? 'HIGH' : 'LOW',
      notes: 'Seeded verification profile for live-call identity checks.',
    },
    products: [scenario.product],
    orderTotal: scenario.product.totalPrice,
    payment: scenario.payment,
    delivery: {
      ...scenario.delivery,
      currentAddress: scenario.customer.address,
      deliverySlot: '10:00-14:00',
    },
    issueSummary: {
      openTickets,
      lastTicketId: openTickets ? `TCK-${scenario.orderId.slice(-5)}` : null,
      lastIssueType: openTickets ? scenario.call.issueType : null,
    },
    callLog: {
      hasCall: true,
      intent: scenario.call.intent,
      sentiment: scenario.call.sentiment,
      flagged: scenario.call.flags.length > 0,
    },
    createdAt: daysAgo(10),
  };
}

function buildCallLog(scenario) {
  return {
    call_id: scenario.call.callId,
    timestamp: daysAgo(1),
    agent_id: scenario.call.agent,
    customer_id: scenario.customer.customerId,
    order_id: scenario.orderId,
    issue_ticket_id: scenario.call.ticket ? `TCK-${scenario.orderId.slice(-5)}` : null,
    audio_url: `s3://mocked/live/${scenario.call.callId}.webm`,
    duration_secs: 210,
    transcript: scenario.call.transcript,
    user_input: scenario.call.transcript,
    system_processed_input: scenario.call.transcript,
    intent: scenario.call.intent,
    entities: {
      order_id: scenario.orderId,
      email: scenario.customer.email,
      phone: scenario.customer.phone,
      name: scenario.customer.name,
    },
    verification: {
      stage: 'VERIFIED',
      result: 'PASSED',
      matched_fields: ['orderId', 'name'],
      mismatched_fields: [],
      confidence_score: 0.94,
      verified_at: daysAgo(1),
    },
    agent_stage: 'VERIFIED',
    status: 'verified',
    notes: scenario.call.summary,
    processing_status: 'COMPLETED',
    ai_result: {
      intent: scenario.call.intent,
      summary: scenario.call.summary,
      confidence: scenario.call.confidence,
      sentiment: scenario.call.sentiment,
      agent_action: scenario.call.agentAction,
      action_payload: {
        orderId: scenario.orderId,
        reason: scenario.call.summary,
      },
    },
    governance_result: {
      status: scenario.call.flags.length ? 'REVIEW_REQUIRED' : 'APPROVED',
      governance_score: scenario.call.confidence,
      flags: scenario.call.flags,
      masked_transcript: scenario.call.transcript.replace(scenario.customer.phone, '[PHONE REDACTED]').replace(scenario.customer.email, '[EMAIL REDACTED]'),
    },
    pipeline_stages: [
      { stage: 'TRANSCRIBE', status: 'SUCCESS', message: 'Seed transcript loaded', duration_ms: 120, completed_at: daysAgo(1) },
      { stage: 'VERIFY', status: 'SUCCESS', message: 'Customer verified from seeded order', duration_ms: 80, completed_at: daysAgo(1) },
      { stage: 'AGENT_ASSIST', status: 'SUCCESS', message: 'Agent action generated', duration_ms: 150, completed_at: daysAgo(1) },
    ],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  };
}

function buildDeliveryOrder(scenario) {
  const statusMap = {
    PROCESSING: 'PROCESSING',
    PACKED: 'PROCESSING',
    SHIPPED: 'SHIPPED',
    OUT_FOR_DELIVERY: 'SHIPPED',
    DELIVERED: 'DELIVERED',
    RETURNED: 'FAILED',
    CANCELLED: 'CANCELLED',
  };

  return {
    order_id: scenario.orderId,
    call_id: scenario.call.callId,
    customer_id: scenario.customer.customerId,
    intent: scenario.call.intent,
    items: [scenario.product],
    delivery_address: scenario.customer.address,
    contact_number: scenario.customer.phone,
    notes: `${scenario.delivery.carrier} - AED ${scenario.product.totalPrice} - ${scenario.call.summary}`,
    status: statusMap[scenario.delivery.status] || 'PENDING',
    governance_status: scenario.call.flags.length ? 'REVIEW_REQUIRED' : 'APPROVED',
    flagged: scenario.call.flags.length > 0,
    updated_by: 'SEEDER',
    history: [{
      status: statusMap[scenario.delivery.status] || 'PENDING',
      changed_by: 'SEEDER',
      note: 'Seeded from order and call scenario',
    }],
  };
}

function buildTicket(scenario) {
  return {
    ticket_id: `TCK-${scenario.orderId.slice(-5)}`,
    call_id: scenario.call.callId,
    order_id: scenario.orderId,
    customer_id: scenario.customer.customerId,
    customer: {
      name: scenario.customer.name,
      email: scenario.customer.email,
      phone: scenario.customer.phone,
    },
    issue_type: scenario.call.issueType,
    priority: scenario.call.flags.includes('LEGAL_THREAT') ? 'URGENT' : scenario.call.sentiment === 'VERY_NEGATIVE' ? 'HIGH' : 'MEDIUM',
    status: 'OPEN',
    summary: scenario.call.summary,
    transcript_excerpt: scenario.call.transcript,
    assigned_team: scenario.call.flags.includes('LEGAL_THREAT') ? 'Escalations' : scenario.call.issueType === 'REFUND_REQUEST' ? 'Billing Support' : 'Customer Support',
    source: 'SEED',
    verification: {
      stage: 'VERIFIED',
      result: 'PASSED',
      matched_fields: ['orderId', 'name'],
      confidence_score: 0.94,
    },
    governance: {
      status: scenario.call.flags.length ? 'REVIEW_REQUIRED' : 'APPROVED',
      flags: scenario.call.flags,
      pii_detected: true,
      compliance_note: scenario.call.flags.includes('LEGAL_THREAT') ? 'Escalate to compliance before making commitments.' : null,
    },
    action: {
      requested: scenario.call.agentAction,
      payload: {
        orderId: scenario.orderId,
        reason: scenario.call.summary,
      },
    },
    history: [{
      status: 'OPEN',
      changed_by: 'SEEDER',
      note: 'Seed ticket created for issue workflow testing',
    }],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  };
}

async function seed() {
  try {
    await mongoose.connect(config.db.uri);
    console.log(`Connected to MongoDB: ${config.db.uri}`);

    await Promise.all([
      Order.deleteMany({}),
      CallLog.deleteMany({}),
      DeliveryOrder.deleteMany({}),
      IssueTicket.deleteMany({}),
    ]);

    const orders = scenarios.map(buildOrder);
    const callLogs = scenarios.map(buildCallLog);
    const deliveryOrders = scenarios.map(buildDeliveryOrder);
    const tickets = scenarios.filter(s => s.call.ticket).map(buildTicket);

    await Order.insertMany(orders);
    await CallLog.insertMany(callLogs);
    await DeliveryOrder.insertMany(deliveryOrders);
    await IssueTicket.insertMany(tickets);

    console.log(`Seeded ${orders.length} orders for verification lookup.`);
    console.log(`Seeded ${callLogs.length} call logs with AI/governance results.`);
    console.log(`Seeded ${deliveryOrders.length} delivery records.`);
    console.log(`Seeded ${tickets.length} issue tickets.`);
    console.log('Sample verification phrase: "My name is Sarah Mitchell, order ORD-2024-01001, phone 050-112-3344."');
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seed();
