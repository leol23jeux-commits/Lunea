// Rappel push la veille des règles. Appelé chaque jour par le cron Vercel (voir vercel.json).
import crypto from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb = (s) => Buffer.from(s, 'base64url');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

function vapidAuth(endpoint) {
  const pub = unb(process.env.VAPID_PUBLIC);
  const key = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: process.env.VAPID_PRIVATE },
    format: 'jwk'
  });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: process.env.VAPID_SUBJECT
  }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + process.env.VAPID_PUBLIC;
}

function encrypt(sub, text) {
  const ua = unb(sub.keys.p256dh), auth = unb(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(ua);
  const salt = crypto.randomBytes(16);
  const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const hdr = Buffer.alloc(21);
  salt.copy(hdr);
  hdr.writeUInt32BE(4096, 16);
  hdr[20] = 65;
  return Buffer.concat([hdr, asPub, ct]);
}

export default async function handler(req, res) {
  const E = process.env;
  if (!E.CRON_SECRET || req.headers.authorization !== 'Bearer ' + E.CRON_SECRET) return res.status(401).end();
  if (!E.SUPABASE_URL || !E.SUPABASE_SERVICE_KEY || !E.VAPID_PUBLIC || !E.VAPID_PRIVATE || !E.VAPID_SUBJECT)
    return res.status(500).json({ error: 'Variables d’environnement manquantes' });

  const paris = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const now = new Date(), today = paris(now), tomorrow = paris(new Date(now.getTime() + 864e5));
  const H = { apikey: E.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + E.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };

  const r = await fetch(E.SUPABASE_URL + '/rest/v1/push_subs?next_date=eq.' + tomorrow + '&select=user_id,sub,last_sent', { headers: H });
  if (!r.ok) return res.status(500).json({ error: 'Lecture Supabase impossible', status: r.status });
  const rows = await r.json();

  let sent = 0, removed = 0, failed = 0;
  for (const row of rows) {
    if (row.last_sent === today) continue;
    try {
      const p = await fetch(row.sub.endpoint, {
        method: 'POST',
        headers: {
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'normal',
          Authorization: vapidAuth(row.sub.endpoint)
        },
        body: encrypt(row.sub, JSON.stringify({ title: 'Lunéa 🌙', body: 'Tes règles sont prévues demain. Pense à tes protections 💗' }))
      });
      const q = 'user_id=eq.' + row.user_id;
      if (p.status === 404 || p.status === 410) {
        await fetch(E.SUPABASE_URL + '/rest/v1/push_subs?' + q, { method: 'DELETE', headers: H });
        removed++;
      } else if (p.ok) {
        await fetch(E.SUPABASE_URL + '/rest/v1/push_subs?' + q, { method: 'PATCH', headers: H, body: JSON.stringify({ last_sent: today }) });
        sent++;
      } else failed++;
    } catch (e) { failed++; }
  }
  res.status(200).json({ date: tomorrow, sent, removed, failed });
}
