const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const streamingService = require('../services/streamingService');

// Get direct stream URL as JSON
router.get('/url', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter q is required' });
    }
    const url = await streamingService.getStreamUrl(query);
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stream audio directly via server proxy with HTTP Range support
// Pipes ALL audio through the server to avoid YouTube IP-binding 403 blocks on mobile.
// NEVER redirect the client to googlevideo URLs -- those are IP-bound to the server.
router.get('/play', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).send('Query parameter q is required');
    }
    const streamUrl = await streamingService.getStreamUrl(query);

    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    };

    if (req.headers.range) {
      requestHeaders['Range'] = req.headers.range;
    }

    // Helper: fetch a URL and follow redirects server-side (up to 5 hops)
    const pipeStream = (url, hops) => {
      if (hops > 5) {
        if (!res.headersSent) res.status(502).send('Too many redirects');
        return;
      }
      const client = url.startsWith('https') ? https : http;
      const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
      const proxyReq = client.request(url, { method, headers: requestHeaders }, (proxyRes) => {
        // Follow redirects on the server side -- never pass IP-bound URLs to the client
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          proxyRes.resume(); // drain the response body
          return pipeStream(proxyRes.headers.location, hops + 1);
        }

        res.status(proxyRes.statusCode);
        res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'audio/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (proxyRes.headers['content-range']) {
          res.setHeader('Content-Range', proxyRes.headers['content-range']);
        }
        if (proxyRes.headers['content-length']) {
          res.setHeader('Content-Length', proxyRes.headers['content-length']);
        }

        if (req.method === 'HEAD') {
          proxyRes.resume();
          return res.end();
        }

        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[StreamProxy] Proxy pipe error:', err.message);
        if (!res.headersSent) {
          res.status(502).send('Stream proxy error');
        }
      });

      proxyReq.end();

      req.on('close', () => {
        proxyReq.destroy();
      });
    };

    pipeStream(streamUrl, 0);
  } catch (err) {
    console.error('[StreamProxy] Error:', err.message);
    res.status(500).send('Stream error: ' + err.message);
  }
});

// Download audio stream as file attachment
router.get('/download', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).send('Query parameter q is required');
    }
    const streamUrl = await streamingService.getStreamUrl(query);
    const rawFilename = req.query.filename || `${query}.m4a`;
    const cleanFilename = rawFilename.replace(/[/\\?%*:|"<>]/g, '').trim() || 'track.m4a';

    const client = streamUrl.startsWith('https') ? https : http;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanFilename)}"`);
    res.setHeader('Content-Type', 'audio/mp4');

    const downloadReq = client.get(streamUrl, (downRes) => {
      if (downRes.statusCode >= 300 && downRes.statusCode < 400 && downRes.headers.location) {
        return res.redirect(302, downRes.headers.location);
      }
      if (downRes.headers['content-length']) {
        res.setHeader('Content-Length', downRes.headers['content-length']);
      }
      downRes.pipe(res);
    });

    downloadReq.on('error', () => {
      if (!res.headersSent) res.redirect(302, streamUrl);
    });

    req.on('close', () => downloadReq.destroy());
  } catch (err) {
    res.status(500).send('Download error: ' + err.message);
  }
});

// Prefetch multiple track stream URLs in parallel (Gapless Playback Engine)
router.post('/prefetch', async (req, res, next) => {
  try {
    const queries = req.body && Array.isArray(req.body.queries) ? req.body.queries : [];
    if (queries.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const data = await streamingService.prefetchUrls(queries);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fast search with parallel catalog lookups
router.get('/search/fast', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter q is required' });
    }
    const results = await streamingService.searchTracksParallel(query, parseInt(req.query.limit, 10) || 10);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search YouTube tracks
router.get('/search', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter q is required' });
    }
    const results = await streamingService.searchTracks(query, parseInt(req.query.limit, 10) || 5);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
