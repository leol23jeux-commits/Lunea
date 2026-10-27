self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data.json(); } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Lunéa 🌙', {
    body: d.body || '',
    icon: '/apple-touch-icon.PNG',
    badge: '/apple-touch-icon.PNG',
    tag: 'lunea-rappel'
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (l) {
    return l.length ? l[0].focus() : clients.openWindow('/');
  }));
});