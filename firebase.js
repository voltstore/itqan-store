/**
 * =============================================================================
 * ITQAN STORE — FIREBASE BOOTSTRAP (firebase.js)
 * =============================================================================
 * A single, tiny init point shared by the store and the admin panel.
 * Exposes `window.ItqanFB` with:
 *   ready()   → true only when a real config is present AND the SDK is loaded
 *   db()      → firebase.database()   (Realtime Database)
 *   auth()    → firebase.auth()       (admin login — admin page only)
 *   storage() → firebase.storage()    (product images — admin page only)
 *
 * When not configured (placeholder config, or CDN blocked), ready() is false
 * and every consumer falls back to the local inventory.js / settings.js.
 * =============================================================================
 */
(function (global) {
  'use strict';

  const cfg = global.ITQAN_FIREBASE || {};

  /** Configured = SDK present + a real (non-placeholder) apiKey + databaseURL.
   *  Unfilled placeholders ("XXXX", "your-project", or "[...]" brackets) count
   *  as NOT configured, so the site safely falls back to local data. */
  function configured() {
    const k = String(cfg.apiKey || '');
    const url = String(cfg.databaseURL || '');
    return typeof firebase !== 'undefined'
      && !!cfg.apiKey && !!cfg.databaseURL
      && !k.includes('XXXX') && !k.includes('[')
      && !url.includes('your-project') && !url.includes('[');
  }

  let inited = false;
  function init() {
    if (!configured()) return null;
    if (!inited) {
      try { firebase.initializeApp(cfg); }
      catch (e) { /* already initialized — ignore */ }
      inited = true;
    }
    return firebase.app();
  }

  global.ItqanFB = {
    ready: configured,
    init,
    db() { init(); return firebase.database(); },
    auth() { init(); return firebase.auth(); },
    storage() { init(); return firebase.storage(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
