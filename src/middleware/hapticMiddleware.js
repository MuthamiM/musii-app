/**
 * Haptic & Device Capabilities Middleware
 * Detects device vibration capabilities and sets client hint headers
 */
function hapticMiddleware(req, res, next) {
  const userAgent = req.headers['user-agent'] || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  
  // Attach haptic feedback capability profile to response headers
  res.setHeader('X-BitChord-Haptic-Supported', isMobile ? 'true' : 'audio-synthesized');
  res.setHeader('X-BitChord-Theme-Engine', 'Liquid-Glassmorphism-v2');
  
  req.deviceProfile = {
    isMobile,
    hapticMode: isMobile ? 'vibrate-api' : 'audio-synthetic'
  };

  next();
}

module.exports = hapticMiddleware;

