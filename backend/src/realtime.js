import { Server } from 'socket.io';
import { createLimiter } from './limits.js';
import { attachRoomPresence } from './rooms/presence.js';

export function attachRealtime(server, config, auth, rooms, options = {}) {
  const allowed = origin => config.allowedOrigins.includes(origin);
  const handshake = createLimiter(config.handshakeRateLimit, config.rateWindowMs);
  const pending = new Map();
  const release = request => pending.get(request)?.();
  const io = new Server(server, {
    path: config.socketPath,
    serveClient: false,
    maxHttpBufferSize: config.maxMessageBytes,
    perMessageDeflate: false,
    httpCompression: false,
    connectTimeout: 5000,
    cors: { origin: config.allowedOrigins, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] },
    allowRequest(request, done) {
      if (!allowed(request.headers.origin) || io.engine.clientsCount + pending.size >= config.connectionLimit ||
          !handshake(request.socket.remoteAddress)) return done(null, false);
      // Reserve capacity before Engine.IO's asynchronous ID generation.
      const cleanup = () => {
        clearTimeout(deadline);
        request.socket.off('close', cleanup);
        pending.delete(request);
      };
      const deadline = setTimeout(cleanup, 5000);
      deadline.unref();
      pending.set(request, cleanup);
      request.socket.once('close', cleanup);
      done(null, true);
    }
  });
  io.engine.on('connection', socket => release(socket.request));
  io.engine.on('close', () => { for (const cleanup of pending.values()) cleanup(); });
  // Also enforce Origin on subsequent polling requests and transport upgrades.
  io.engine.use((request, response, next) => {
    if (!allowed(request.headers.origin)) return next(new Error('ORIGIN_DENIED'));
    next();
  });
  const presence = attachRoomPresence(io, auth, rooms, config, options);

  if (config.diagnostics) {
    io.of('/diagnostics').on('connection', socket => {
      const acceptEvent = createLimiter(config.eventRateLimit, config.rateWindowMs);
      socket.onAny((event, ...args) => {
        const ack = typeof args.at(-1) === 'function' ? args.pop() : () => {};
        const fail = code => ack({ ok: false, error: { code } });
        if (!acceptEvent('socket')) {
          fail('RATE_LIMITED');
          socket.disconnect(true);
          return;
        }
        if (event !== 'system:ping') return fail('EVENT_NOT_AVAILABLE');
        const payload = args[0];
        if (args.length !== 1 || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
            Object.keys(payload).sort().join(',') !== 'id,version' || payload.version !== 1 ||
            typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.id)) {
          return fail('INVALID_MESSAGE');
        }
        ack({ ok: true, version: 1, id: payload.id });
      });
    });
  }
  return { io, presence };
}
