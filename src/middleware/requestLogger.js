/**
 * HTTP Request Logger Middleware
 * Logs method, path, status, latency and user-agent
 */
function requestLogger(req, res, next) {
  const startTime = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(startTime);
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    const status = res.statusCode;
    const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : status >= 300 ? '\x1b[36m' : '\x1b[32m';
    const reset = '\x1b[0m';

    console.log(`[BitChord Server] ${req.method} ${req.originalUrl} ${color}${status}${reset} - ${durationMs}ms`);
  });

  next();
}

module.exports = requestLogger;

