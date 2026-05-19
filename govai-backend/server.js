// server.js
// Entry point. Creates the HTTP server, attaches Socket.io,
// connects to MongoDB, then starts listening.

require('dotenv').config();
const http     = require('http');
const { Server } = require('socket.io');
const app      = require('./app');
const { connectDB } = require('./src/config/database');
const config   = require('./src/config');
const logger   = require('./src/utils/logger');

async function bootstrap() {
  // 1. Connect to MongoDB
  await connectDB();

  // 2. Create HTTP server
  const server = http.createServer(app);

  // 3. Attach Socket.io for real-time pipeline events
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Make io available to controllers via req.app.get('io')
  app.set('io', io);

  // Socket.io connection handler
  io.on('connection', (socket) => {
    logger.info('WebSocket client connected', { socketId: socket.id });

    // Client can subscribe to a specific call's events
    socket.on('subscribe:call', (callId) => {
      socket.join(`call:${callId}`);
      logger.debug('Client subscribed to call', { callId, socketId: socket.id });
    });

    // Real-time audio streaming
    socket.on('call:stream:start', (data) => {
      logger.info('Live stream started', { callId: data.callId });
      socket.join(`live:${data.callId}`);
    });

    socket.on('call:stream:audio', async (data) => {
      // Pass the audio chunk to the live stream service
      const { processLiveChunk } = require('./src/services/liveStreamService');
      await processLiveChunk(data.callId, data.audioChunk, io);
    });

    socket.on('call:stream:transcript_input', async (data) => {
      const { processLiveTranscript } = require('./src/services/liveStreamService');
      await processLiveTranscript(data.callId, data.text, io);
    });

    socket.on('call:stream:end', async (data) => {
      const { endCall } = require('./src/services/liveStreamService');
      await endCall(data.callId);
      logger.info('Live stream ended', { callId: data.callId });
    });

    socket.on('disconnect', () => {
      logger.debug('WebSocket client disconnected', { socketId: socket.id });
    });
  });

  // 4. Start listening
  const PORT = config.server.port;
  server.listen(PORT, () => {
    logger.info(`
╔══════════════════════════════════════════════╗
║  GovAI Backend Server                        ║
║  Port    : ${PORT}                                ║
║  Env     : ${config.server.env.padEnd(10)}                   ║
║  Mock AWS: ${String(config.useMockAws).padEnd(10)}                   ║
║  DB      : ${config.db.uri.includes('localhost') ? 'localhost'.padEnd(10) : 'remote'.padEnd(10)}                   ║
╚══════════════════════════════════════════════╝
    `.trim());
  });

  // 5. Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      const { disconnectDB } = require('./src/config/database');
      await disconnectDB();
      logger.info('Server closed');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
