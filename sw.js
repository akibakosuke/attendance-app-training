const CACHE_NAME = 'attendance-app-v1';
const REPO_NAME = '/attendance-app-training';
const ASSETS = [
    REPO_NAME + '/',
    REPO_NAME + '/index.html',
    REPO_NAME + '/style.css',
    REPO_NAME + '/script.js',
    REPO_NAME + '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => response || fetch(event.request))
    );
});
