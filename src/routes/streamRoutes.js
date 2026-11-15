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
// Eliminates YouTube IP-binding 403 blocks on mobile and enables instant bufferless playback
router.get('/play', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).send('Query parameter q is required');
    }
    const streamUrl = await streamingService.getStreamUrl(query);

    const client = streamUrl.startsWith('https') ? https : http;
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    };

    if (req.headers.range) {
      requestHeaders['Range'] = req.headers.range;
    }

    const proxyReq = client.get(streamUrl, { headers: requestHeaders }, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        return res.redirect(proxyRes.statusCode, proxyRes.headers.location);
      }

      res.status(proxyRes.statusCode);
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'audio/webm');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (proxyRes.headers['content-range']) {
        res.setHeader('Content-Range', proxyRes.headers['content-range']);
      }
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }

      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[StreamProxy] Proxy pipe error:', err.message);
      if (!res.headersSent) {
        res.redirect(302, streamUrl);
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
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
