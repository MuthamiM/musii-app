const express = require('express');
const path = require('path');
const cors = require('cors');

const env = require('./src/config/env');
const db = require('./src/db/database');
const requestLogger = require('./src/middleware/requestLogger');
const hapticMiddleware = require('./src/middleware/hapticMiddleware');
const errorHandler = require('./src/middleware/errorHandler');
const { NotFoundError } = require('./src/errors');
const apiRouter = require('./src/routes/api');
const { createEdgeServer } = require('./src/servers/audioEdgeServer');

const app = express();

app.disable('x-powered-by');

app.use(cors({
  origin: env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-MUSII-Client']
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(requestLogger);
app.use(hapticMiddleware);

// Serve frontend static assets with cache control
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath, {
  maxAge: env.IS_PRODUCTION ? '1d' : '0',
  etag: true,
  lastModified: true
}));

app.use('/api', apiRouter);

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.use((req, res, next) => {
  next(new NotFoundError('Endpoint', req.originalUrl));
});

app.use(errorHandler);

// Start edge streaming nodes for zero-buffering scalability
const edgeNode1 = createEdgeServer(5051, 'US-East-Audio-Edge');
const edgeNode2 = createEdgeServer(5052, 'EU-Central-Audio-Edge');
const edgeNode3 = createEdgeServer(5053, 'AP-East-Audio-Edge');

// Primary API server startup (strictly NO emojis)
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`======================================================`);
  console.log(`[MUSII Engine] Primary API active on http://localhost:${env.PORT}`);
  console.log(`[MUSII Cluster] 3 Distributed Edge Audio Servers online: 5051, 5052, 5053`);
  console.log(`[MUSII Database] better-sqlite3 WAL Mode Active`);
  console.log(`[MUSII Client] Android and iPhone PWA Ready`);
  console.log(`======================================================`);
});

function handleShutdown(signal) {
  console.log(`[MUSII Server] Received ${signal}. Shutting down cluster...`);
  try { edgeNode1.close(); } catch(e){}
  try { edgeNode2.close(); } catch(e){}
  try { edgeNode3.close(); } catch(e){}
  server.close(() => {
    try {
      db.close();
      console.log('[MUSII Database] SQLite connection closed cleanly.');
    } catch (e) {}
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

module.exports = { app, server };
