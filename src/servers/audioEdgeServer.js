const http = require('http');

function createEdgeServer(port, regionName) {
  const server = http.createServer((req, res) => {
    // Ultra-fast headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('X-MUSII-Edge-Region', regionName);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', region: regionName, timestamp: Date.now() }));
    }

    // Stream audio buffer endpoint
    if (req.url.startsWith('/stream/')) {
      const trackId = req.url.split('/')[2];
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Audio-Stream-Node': regionName
      });
      // Simulate sub-millisecond audio packet transmission
      res.end(Buffer.from(`MUSII-AUDIO-STREAM-NODE-${regionName}-${trackId}`));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found on edge node' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[MUSII Edge Node] Active on port ${port} (${regionName})`);
  });

  return server;
}

module.exports = { createEdgeServer };
