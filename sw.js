const CACHE_NAME = 'tuktuk-v7-supabase';
const ASSETS = [
    './',
    'index.html',
    'style.css',
    'app.js',
    'manifest.json',
    'logo.svg',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/lucide@0.400.0/dist/umd/lucide.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install Event
self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('SW: Pre-caching assets');
            return cache.addAll(ASSETS).catch(error => {
                console.error('SW: Pre-cache error:', error);
            });
        })
    );
});

// Activate Event
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys
                .filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))
            );
        })
    );
    return self.clients.claim();
});

// Simple Cache-First Strategy
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((res) => {
            if (res) return res;

            return fetch(e.request).then(response => {
                // Don't cache if not a valid response
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    // For cross-origin (CDN), we can cache if it's a CORS request
                    if (e.request.url.includes('unpkg.com') || e.request.url.includes('cdn.jsdelivr.net') || e.request.url.includes('fonts.googleapis.com')) {
                        let responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseClone));
                        return response;
                    }
                    return response;
                }

                let responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseClone));
                return response;
            }).catch(() => {
                // If both fail, and it's index.html, return it
                if (e.request.mode === 'navigate') {
                    return caches.match('index.html');
                }
            });
        })
    );
});
