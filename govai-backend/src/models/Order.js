const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  orderId:         { type: String, unique: true },
  customer: {
    customerId:     String,
    name:          String,
    email:         String,
    phone:         String,
    alternatePhone:String,
    address:       String,
    city:          String,
    emirate:       String,
  },
  verification: {
    preferredFields: { type: [String], default: ['orderId', 'name', 'phone'] },
    lastVerifiedAt:  Date,
    riskLevel:       { type: String, default: 'LOW' },
    notes:           String,
  },
  products: [{
    sku:           String,
    name:          String,
    category:      String,
    quantity:      Number,
    unitPrice:     Number,
    totalPrice:    Number,
  }],
  orderTotal:      Number,
  payment: {
    method:        String,   
    status:        String,   
    transactionId: String,
    paidAt:        Date,
  },
  delivery: {
    status:        String,   
    carrier:       String,
    trackingNo:    String,
    currentAddress:String,
    deliverySlot:  String,
    estimatedDate: Date,
    deliveredAt:   Date,
  },
  issueSummary: {
    openTickets:   { type: Number, default: 0 },
    lastTicketId:  String,
    lastIssueType: String,
  },
  callLog: {
    hasCall:       Boolean,
    intent:        String,
    sentiment:     String,
    flagged:       Boolean,
  },
  createdAt:       { type: Date, default: Date.now },
}, { collection: 'orders' });

module.exports = mongoose.model('Order', OrderSchema);
