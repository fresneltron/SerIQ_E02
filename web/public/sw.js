const CACHE_NAME = 'seriq-shell-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['/','/manifest.webmanifest','/icons/seriq.svg','/icons/seriq-192.png','/icons/seriq-512.png','/icons/apple-touch-icon.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('seriq-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/models/') || url.pathname.startsWith('/wasm/')) return
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && (request.mode === 'navigate' || url.pathname.startsWith('/assets/'))) {
      const copy = response.clone()
      void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
    }
    return response
  }).catch(async () => (await caches.match(request)) ?? (request.mode === 'navigate' ? caches.match('/') : undefined)))
})
