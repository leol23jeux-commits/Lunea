self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data.json(); } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Lunéa 🌙', {
    body: d.body || '',
    icon: '/apple-touch-icon.PNG',
    badge: '/apple-touch-icon.PNG',
    tag: 'lunea-rappel',
    data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (l) {
    if (l.length) {
      var c = l[0];
      return c.focus().then(function () { if (c.navigate) return c.navigate(u); });
    }
    return clients.openWindow(u);
  }));
});
