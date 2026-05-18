// scripts/seedOrders.js
// Run with: node scripts/seedOrders.js

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/govai';

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
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
    method:        String,   // CREDIT_CARD | DEBIT_CARD | COD | BANK_TRANSFER | WALLET
    status:        String,   // PAID | PENDING | FAILED | REFUNDED
    transactionId: String,
    paidAt:        Date,
  },
  delivery: {
    status:        String,   // PROCESSING | PACKED | SHIPPED | OUT_FOR_DELIVERY | DELIVERED | CANCELLED | RETURNED
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

const Order = mongoose.model('Order', OrderSchema);

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const USERS = [
  { name: 'Sarah Mitchell',  email: 'sarah.mitchell@email.com',   phone: '050-112-3344', city: 'Dubai',       address: '45 Marina Tower, Dubai Marina' },
  { name: 'James Okonkwo',   email: 'j.okonkwo@email.com',        phone: '055-223-4455', city: 'Abu Dhabi',   address: '12 Al Wasl Road, Khalidiyah' },
  { name: 'Lisa Chen',       email: 'lisa.chen@email.com',         phone: '050-334-5566', city: 'Sharjah',     address: '88 Al Nahda Street, Al Qasimia' },
  { name: 'Robert Alvarez',  email: 'r.alvarez@email.com',         phone: '056-445-6677', city: 'Dubai',       address: '7 Business Bay, Tower B' },
  { name: 'Amara Diallo',    email: 'amara.d@email.com',           phone: '052-556-7788', city: 'Ajman',       address: '3 Corniche Road, Ajman' },
  { name: 'Mohammed Al Rashid', email: 'm.rashid@email.com',       phone: '054-667-8899', city: 'Dubai',       address: '101 Jumeirah Beach Road' },
  { name: 'Priya Sharma',    email: 'priya.s@email.com',           phone: '050-778-9900', city: 'Abu Dhabi',   address: '22 Electra Street, Al Markaziyah' },
  { name: 'Ethan Williams',  email: 'ethan.w@email.com',           phone: '055-889-0011', city: 'Dubai',       address: '5 Downtown Blvd, Burj Khalifa District' },
  { name: 'Fatima Al Zaabi', email: 'fatima.z@email.com',          phone: '056-990-1122', city: 'Al Ain',      address: '14 Zayed Bin Sultan Street' },
  { name: 'Carlos Mendes',   email: 'carlos.m@email.com',          phone: '052-001-2233', city: 'Dubai',       address: '78 Deira, Al Rigga Street' },
  { name: 'Nadia Petrov',    email: 'nadia.p@email.com',           phone: '054-112-3344', city: 'Sharjah',     address: '44 University City Road' },
  { name: 'Omar Farouq',     email: 'omar.f@email.com',            phone: '050-223-4455', city: 'Dubai',       address: '9 DIFC Gate Village' },
  { name: 'Yuki Tanaka',     email: 'yuki.t@email.com',            phone: '055-334-5566', city: 'Abu Dhabi',   address: '31 Hamdan Street, Al Markaziyah' },
  { name: 'Grace Adeyemi',   email: 'grace.a@email.com',           phone: '056-445-6677', city: 'Dubai',       address: '60 Al Quoz Industrial Area 1' },
  { name: 'Daniel Kovač',    email: 'daniel.k@email.com',          phone: '052-556-7788', city: 'Ras Al Khaimah', address: '18 Al Nakheel Road' },
  { name: 'Aisha Bangura',   email: 'aisha.b@email.com',           phone: '054-667-8899', city: 'Dubai',       address: '25 JBR Walk, Jumeirah Beach' },
  { name: 'Lucas Ferreira',  email: 'lucas.f@email.com',           phone: '050-778-9900', city: 'Abu Dhabi',   address: '55 Corniche East, Tourist Club Area' },
  { name: 'Elena Bogdanova', email: 'elena.b@email.com',           phone: '055-889-0011', city: 'Dubai',       address: '3 Palm Jumeirah, Shoreline Apt' },
  { name: 'Tariq Al Mansouri', email: 't.mansouri@email.com',      phone: '056-990-1122', city: 'Fujairah',    address: '7 Hamad Bin Abdullah Road' },
  { name: 'Sophie Laurent',  email: 'sophie.l@email.com',          phone: '052-001-2233', city: 'Dubai',       address: '19 Emirates Hills, Sector W' },
];

const PRODUCTS = [
  { name: 'Samsung Galaxy S24 Ultra',     category: 'Electronics',  unitPrice: 4899 },
  { name: 'Apple iPhone 15 Pro',          category: 'Electronics',  unitPrice: 4299 },
  { name: 'Sony WH-1000XM5 Headphones',  category: 'Electronics',  unitPrice: 1099 },
  { name: 'LG 55" OLED Smart TV',        category: 'Electronics',  unitPrice: 3799 },
  { name: 'Dell XPS 15 Laptop',          category: 'Electronics',  unitPrice: 6499 },
  { name: 'Dyson V15 Vacuum Cleaner',    category: 'Home Appliances', unitPrice: 2199 },
  { name: 'Nespresso Vertuo Coffee Machine', category: 'Home Appliances', unitPrice: 699 },
  { name: 'Nike Air Max 270',            category: 'Fashion',       unitPrice: 449 },
  { name: 'Adidas Ultraboost 23',        category: 'Fashion',       unitPrice: 399 },
  { name: 'Zara Linen Blazer',           category: 'Fashion',       unitPrice: 289 },
  { name: 'The Ordinary Serum Set',      category: 'Beauty',        unitPrice: 149 },
  { name: 'LEGO Technic Bugatti',        category: 'Toys',          unitPrice: 899 },
  { name: 'Instant Pot Duo 7-in-1',     category: 'Home Appliances', unitPrice: 449 },
  { name: 'Kindle Paperwhite',           category: 'Electronics',   unitPrice: 599 },
  { name: 'GoPro HERO12 Black',         category: 'Electronics',   unitPrice: 1699 },
  { name: 'Philips Air Fryer XXL',       category: 'Home Appliances', unitPrice: 749 },
  { name: 'Levi\'s 511 Slim Jeans',     category: 'Fashion',        unitPrice: 199 },
  { name: 'Vitamix Blender A2500',       category: 'Home Appliances', unitPrice: 1899 },
  { name: 'Ray-Ban Aviator Sunglasses',  category: 'Fashion',        unitPrice: 799 },
  { name: 'Fitbit Charge 6',            category: 'Electronics',    unitPrice: 899 },
  { name: 'IKEA KALLAX Shelf Unit',      category: 'Furniture',      unitPrice: 349 },
  { name: 'Garmin Forerunner 265',       category: 'Electronics',    unitPrice: 1599 },
  { name: 'L\'Oréal Elvive Shampoo Pack', category: 'Beauty',        unitPrice: 89  },
  { name: 'Weber Spirit II Gas Grill',   category: 'Outdoor',        unitPrice: 2499 },
];

const PAYMENT_METHODS  = ['CREDIT_CARD', 'DEBIT_CARD', 'COD', 'BANK_TRANSFER', 'WALLET'];
const PAYMENT_STATUSES = ['PAID', 'PAID', 'PAID', 'PENDING', 'FAILED', 'REFUNDED']; // weighted toward PAID
const DELIVERY_STATUSES = ['PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'CANCELLED', 'RETURNED'];
const CARRIERS         = ['Aramex', 'DHL Express', 'FedEx', 'Emirates Post', 'Fetchr'];
const CALL_INTENTS     = ['REFUND_REQUEST', 'DELIVERY_ENQUIRY', 'CANCELLATION', 'COMPLAINT', 'INQUIRY', null, null, null]; // null = no call
const SENTIMENTS       = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'VERY_NEGATIVE'];

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function pick(arr)         { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max)    { return Math.floor(Math.random() * (max - min + 1)) + min; }
function daysAgo(n)        { return new Date(Date.now() - n * 86_400_000); }
function txId()            { return 'TXN-' + Math.random().toString(36).slice(2, 10).toUpperCase(); }
function trackingNo()      { return 'TRK' + rand(100000000, 999999999); }
function orderId(i)        { return `ORD-2024-${String(i + 1001).padStart(5, '0')}`; }

function pickProducts() {
  const count = rand(1, 3);
  const shuffled = [...PRODUCTS].sort(() => Math.random() - 0.5).slice(0, count);
  return shuffled.map(p => {
    const qty = rand(1, 3);
    return { ...p, quantity: qty, totalPrice: parseFloat((p.unitPrice * qty).toFixed(2)) };
  });
}

function buildOrder(user, index) {
  const products    = pickProducts();
  const orderTotal  = parseFloat(products.reduce((s, p) => s + p.totalPrice, 0).toFixed(2));
  const payStatus   = pick(PAYMENT_STATUSES);
  const delStatus   = pick(DELIVERY_STATUSES);
  const createdDays = rand(1, 60);
  const intent      = pick(CALL_INTENTS);

  const deliveredAt = delStatus === 'DELIVERED'
    ? daysAgo(rand(1, createdDays - 1))
    : null;

  return {
    orderId:    orderId(index),
    customer:   user,
    products,
    orderTotal,
    payment: {
      method:        pick(PAYMENT_METHODS),
      status:        payStatus,
      transactionId: payStatus !== 'COD' ? txId() : null,
      paidAt:        payStatus === 'PAID' ? daysAgo(rand(1, createdDays)) : null,
    },
    delivery: {
      status:        delStatus,
      carrier:       pick(CARRIERS),
      trackingNo:    trackingNo(),
      estimatedDate: daysAgo(rand(-7, createdDays - 1)), // negative = future date
      deliveredAt,
    },
    callLog: {
      hasCall:   !!intent,
      intent:    intent ?? null,
      sentiment: intent ? pick(SENTIMENTS) : null,
      flagged:   intent ? ['REFUND_REQUEST', 'COMPLAINT', 'CANCELLATION'].includes(intent) : false,
    },
    createdAt: daysAgo(createdDays),
  };
}

// ─── SEED ─────────────────────────────────────────────────────────────────────
async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`✅ Connected to MongoDB: ${MONGO_URI}`);

    // Wipe existing orders
    const deleted = await Order.deleteMany({});
    console.log(`🗑️  Cleared ${deleted.deletedCount} existing orders`);

    const orders = USERS.map((user, i) => buildOrder(user, i));
    await Order.insertMany(orders);

    console.log(`\n🌱 Seeded ${orders.length} orders:\n`);
    orders.forEach(o => {
      console.log(
        `  ${o.orderId}  ${o.customer.name.padEnd(22)}` +
        `  ${o.delivery.status.padEnd(18)}` +
        `  ${o.payment.status.padEnd(10)}` +
        `  AED ${String(o.orderTotal).padStart(7)}` +
        `  ${o.callLog.hasCall ? `📞 ${o.callLog.intent}` : '     —'}`
      );
    });

    console.log('\n✅ Seed complete.\n');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
