// Service Worker placeholder
// 번들 캐싱 없음 — install 완료 후 bundle-skip 메시지로 게임 즉시 시작
self.addEventListener('install', function(e) {
    self.skipWaiting();
});
self.addEventListener('activate', function(e) {
    e.waitUntil(
        clients.claim().then(function() {
            return clients.matchAll({ includeUncontrolled: true, type: 'window' });
        }).then(function(allClients) {
            allClients.forEach(function(client) {
                client.postMessage({ type: 'bundle-skip', reason: 'no bundle' });
            });
        })
    );
});
