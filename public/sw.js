const CACHE_NAME = 'musii-cache-v1.9.10';
const AUDIO_CACHE_NAME = 'musii-audio-cache-v1';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/styles/colors.css',
  '/styles/glass.css',
  '/styles/animations.css',
  '/styles/base.css',
  '/styles/components/bottom-nav.css',
  '/styles/components/mini-player.css',
  '/styles/components/expanded-player.css',
  '/styles/components/cards.css',
  '/styles/components/modal.css',
  '/styles/components/settings.css',
  '/styles/components/search.css',
  '/styles/components/auth.css',
  '/js/main.js',
  '/js/constants/api.js',
  '/js/constants/colors.js',
  '/js/constants/themes.js',
  '/js/constants/tracks.js',
  '/js/errors/clientErrorHandler.js',
  '/js/middleware/hapticMiddleware.js',
  '/js/services/AudioSynthService.js',
  '/js/services/StorageService.js',
  '/js/controllers/AudioController.js',
  '/js/controllers/NavigationController.js',
  '/js/controllers/PlaylistController.js',
  '/js/controllers/ModalController.js',
  '/js/controllers/AppController.js',
  '/js/controllers/AuthController.js',
  '/js/controllers/SettingsController.js',
  '/js/controllers/SearchController.js',
  '/js/controllers/UpdateController.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.log('[ServiceWorker] Assets warm:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== AUDIO_CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Audio Stream caching for offline playback
  if (url.includes('/api/stream/play')) {
    event.respondWith(
      caches.open(AUDIO_CACHE_NAME).then(async audioCache => {
        const cached = await audioCache.match(event.request);
        if (cached) return cached;

        try {
          const networkRes = await fetch(event.request);
          if (networkRes && networkRes.status === 200) {
            audioCache.put(event.request, networkRes.clone());
          }
          return networkRes;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }

  // Network first for API, cache first for static assets
  if (url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(res => {
          if (res.status === 200 && event.request.method === 'GET') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        });
      })
    );
  }
});
