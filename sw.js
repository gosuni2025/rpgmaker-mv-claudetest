// Service Worker placeholder
// 번들 캐싱 기능 없이 단순히 install/activate만 처리
self.addEventListener('install', function(e) {
    self.skipWaiting();
});
self.addEventListener('activate', function(e) {
    e.waitUntil(clients.claim());
});
