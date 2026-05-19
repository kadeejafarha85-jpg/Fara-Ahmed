// app.js
// Express application factory.
// Wires together all middleware, routes, and the error handler.
// Kept separate from server.js so it can be imported in tests without binding a port.

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const requestLogger = require('./src/middleware/requestLogger');
const errorHandler  = require('./src/middleware/errorHandler');
const { apiLimiter } = require('./src/middleware/rateLimiter');

const callsRoutes    = require('./src/routes/calls');
const deliveryRoutes = require('./src/routes/delivery');
const healthRoute    = require('./src/routes/health');
const ticketRoutes   = require('./src/routes/tickets');

const app = express();

// ── Security headers ─────────────────────────────────────────
app.use(helmet());

// ── CORS ─────────────────────────────────────────────────────
app.use(cors({
  origin:  process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Source'],
}));

// ── Body parsing ─────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── HTTP request logging ─────────────────────────────────────
app.use(requestLogger);

// ── Rate limiting (skip in test env) ────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use('/api', apiLimiter);
}

// ── Routes ───────────────────────────────────────────────────
app.use('/health',         healthRoute);
app.use('/api/calls',      callsRoutes);
app.use('/api/delivery',   deliveryRoutes);
app.use('/api/tickets',    ticketRoutes);

// ── API root info ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name:    'GovAI Backend',
    version: '1.0.0',
    docs:    '/health',
    endpoints: {
      upload:          'POST /api/calls/upload',
      process:         'POST /api/calls/process',
      logs:            'GET  /api/calls/logs',
      callDetail:      'GET  /api/calls/:callId',
      createOrder:     'POST /api/delivery/create',
      updateOrder:     'PUT  /api/delivery/update',
      orders:          'GET  /api/delivery/orders',
      createTicket:    'POST /api/tickets/create',
      tickets:         'GET  /api/tickets',
      updateTicket:    'PUT  /api/tickets/update',
    },
  });
});

// ── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler (must be last) ─────────────────────
app.use(errorHandler);

module.exports = app;
