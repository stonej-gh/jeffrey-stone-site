/* Crypto helpers for the encrypted /experimental/ area.
   File format (written by scripts/encrypt-experimental.py):
     "JSE1" + salt(16) + iv(12) + AES-256-GCM ciphertext
   Key = PBKDF2-HMAC-SHA256(passphrase, salt, 310,000 iterations).
   Everything runs locally via Web Crypto; the passphrase never leaves
   the browser. */
const ExpCrypto = {
  ITERATIONS: 310000,   /* keep in sync with scripts/encrypt-experimental.py */

  parse(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 33 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'JSE1')
      throw new Error('not a JSE1 file');
    return { salt: b.slice(4, 20), iv: b.slice(20, 32), ct: b.slice(32) };
  },

  async fetchEnc(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('fetch ' + url + ' -> ' + r.status);
    return this.parse(await r.arrayBuffer());
  },

  async deriveKey(passphrase, salt) {
    const km = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt, iterations: this.ITERATIONS, hash: 'SHA-256' },
      km, 256);
    return this.importKey(new Uint8Array(bits));
  },

  importKey(raw) {
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['decrypt']);
  },

  async exportKey(key) {
    return new Uint8Array(await crypto.subtle.exportKey('raw', key));
  },

  decrypt(key, f) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: f.iv }, key, f.ct);
  },

  /* base64 helpers - only ever used on small values (16-byte salt, 32-byte key) */
  b64(u8) { return btoa(String.fromCharCode.apply(null, u8)); },
  unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
};
