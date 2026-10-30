/* Helpnotes — passordvegg.
 * Viser en påloggingsskjerm før hele systemet kan brukes. Passordet lagres aldri i klartekst:
 * config.js inneholder bare en SHA-256-hash (passwordHash). Se config.js for hvordan du bytter passord.
 *
 * NB: Dette er en enkel vegg i nettleseren. Den holder uvedkommende ute fra siden, men er ikke
 * en erstatning for ekte tilgangsstyring på serveren (Supabase-innlogging beskytter skydata).
 */
(function () {
  'use strict';
  const KEY = 'helpnotes_unlocked';
  const SALT = 'helpnotes-v1:';
  const root = document.documentElement;
  const expected = String((window.IKT_CONFIG && window.IKT_CONFIG.passwordHash) || '').trim().toLowerCase();

  /* SHA-256 uten avhengigheter (crypto.subtle finnes ikke på http:// eller file://) */
  function sha256(message) {
    const bytes = new TextEncoder().encode(message);
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const length = bytes.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(bytes); padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
    view.setUint32(padded.length - 4, (length << 3) >>> 0);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((value, i) => { H[i] = (H[i] + value) >>> 0; });
    }
    return H.map(n => n.toString(16).padStart(8, '0')).join('');
  }

  const read = store => { try { return window[store].getItem(KEY); } catch (error) { return null; } };
  const isUnlocked = () => !expected || read('sessionStorage') === expected || read('localStorage') === expected;
  const gate = () => document.getElementById('gate');
  const app = () => document.getElementById('app');

  function setLocked(locked) {
    root.classList.toggle('locked', locked);
    const shell = app();
    if (shell) { if (locked) shell.setAttribute('inert', ''); else shell.removeAttribute('inert'); }
    if (locked) {
      const input = document.getElementById('gate-password');
      if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
    }
  }

  function lock() {
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch (error) { /* ignorer */ }
    setLocked(true);
  }
  window.HelpnotesAuth = { lock, hash: password => sha256(SALT + password) };

  function init() {
    setLocked(!isUnlocked());
    const form = document.getElementById('gate-form');
    if (!form || !gate()) return;
    const input = document.getElementById('gate-password');
    const error = document.getElementById('gate-error');
    const remember = document.getElementById('gate-remember');
    const toggle = document.getElementById('gate-toggle');
    let failures = 0, blockedUntil = 0;

    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Skjul passord' : 'Vis passord');
      input.focus();
    });
    input.addEventListener('input', () => { error.textContent = ''; gate().classList.remove('is-wrong'); });

    form.addEventListener('submit', event => {
      event.preventDefault();
      const wait = Math.ceil((blockedUntil - Date.now()) / 1000);
      if (wait > 0) { error.textContent = `For mange forsøk. Prøv igjen om ${wait} sekunder.`; return; }
      if (sha256(SALT + input.value) === expected) {
        try { (remember.checked ? localStorage : sessionStorage).setItem(KEY, expected); } catch (err) { /* ignorer */ }
        failures = 0;
        setLocked(false);
        window.location.hash = 'dashboard'; /* etter innlogging går du til dashbordet */
        window.scrollTo(0, 0);
        return;
      }
      failures += 1;
      if (failures >= 5) { blockedUntil = Date.now() + 30000; failures = 0; error.textContent = 'For mange forsøk. Prøv igjen om 30 sekunder.'; }
      else error.textContent = 'Feil passord. Prøv igjen.';
      gate().classList.remove('is-wrong'); void gate().offsetWidth; gate().classList.add('is-wrong');
      input.select();
    });

    document.querySelectorAll('[data-lock]').forEach(button => button.addEventListener('click', lock));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
