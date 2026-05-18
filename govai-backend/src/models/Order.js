const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  orderId:         { type: String, unique: true },
  customer: {
    name:          String,
    email:         String,
    phone:         String,
    address:       String,
    city:          String,
  },
  products: [{
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
    estimatedDate: Date,
    deliveredAt:   Date,
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
