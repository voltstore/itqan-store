/**
 * =============================================================================
 * ITQAN STORE — DATA LAYER (data.js)
 * =============================================================================
 * This file is the ONLY place that knows where product data comes from.
 *
 * PHASE 1 (current): realistic hardcoded demo inventory (bilingual copy).
 * PHASE 2 (later):   swap the body of `getParts()` with a Firebase Realtime
 *                    Database read. Nothing else in the app needs to change,
 *                    because every consumer calls the async `getParts()`
 *                    abstraction and never touches PARTS_DB directly.
 *
 * Example Firebase drop-in replacement:
 *
 *   async function getParts() {
 *     const snapshot = await firebase.database().ref('parts').get();
 *     return snapshot.val();
 *   }
 *
 * Prices are in Saudi Riyal (SAR). Images point to elegant SVG placeholders
 * in /images — replace each file with a real product photo later (keep the
 * same path, or set per-product paths like "images/cpu-ryzen-5-7600.jpg").
 * =============================================================================
 */

/** Display metadata per category — bilingual labels + placeholder image. */
const CATEGORY_META = {
  cpu:         { label: { ar: 'المعالج',     en: 'Processor' },    icon: 'images/cpu.svg' },
  motherboard: { label: { ar: 'اللوحة الأم', en: 'Motherboard' },  icon: 'images/motherboard.svg' },
  gpu:         { label: { ar: 'كرت الشاشة',  en: 'Graphics Card' },icon: 'images/gpu.svg' },
  ram:         { label: { ar: 'الذاكرة',     en: 'Memory' },       icon: 'images/ram.svg' },
  storage:     { label: { ar: 'التخزين',     en: 'Storage' },      icon: 'images/storage.svg' },
  psu:         { label: { ar: 'مزود الطاقة', en: 'Power Supply' }, icon: 'images/psu.svg' },
  case:        { label: { ar: 'الصندوق',     en: 'Case' },         icon: 'images/case.svg' },
  cooler:      { label: { ar: 'المبرد',      en: 'CPU Cooler' },   icon: 'images/cooler.svg' },
};

/** Render / selection order of categories in the builder. */
const CATEGORY_ORDER = ['cpu', 'motherboard', 'gpu', 'ram', 'storage', 'psu', 'case', 'cooler'];

/**
 * The raw inventory now lives in inventory.js (machine-written by the local
 * admin panel admin.html). It sets globalThis.ITQAN_INVENTORY before this
 * file runs. In Node (unit tests) we require it explicitly.
 */
if (typeof window === 'undefined' && typeof require !== 'undefined') {
  require('./inventory.js');
}
const PARTS_DB = globalThis.ITQAN_INVENTORY;

/**
 * Firebase returns arrays as arrays only when keys are contiguous, and drops
 * empty arrays entirely — so coerce whatever comes back into the exact
 * { category: [...] } shape the app expects, with every category present.
 */
function normalizeInventory(val) {
  const out = {};
  for (const cat of CATEGORY_ORDER) {
    const a = val && val[cat];
    out[cat] = Array.isArray(a)
      ? a.filter(Boolean)
      : (a && typeof a === 'object' ? Object.values(a).filter(Boolean) : []);
  }
  return out;
}

/**
 * THE data access abstraction — reads from Firebase Realtime Database when it
 * is configured, and falls back to the bundled local inventory otherwise.
 * Always async, so the two paths are interchangeable.
 *
 * @returns {Promise<Object>} map of category -> array of parts
 */
async function getParts() {
  const FB = globalThis.ItqanFB;
  if (FB && FB.ready()) {
    try {
      const snap = await FB.db().ref('inventory').once('value');
      const val = snap.val();
      if (val) return normalizeInventory(val);
    } catch (e) {
      console.warn('Firebase inventory read failed — using local inventory.js', e);
    }
  }
  return structuredClone(PARTS_DB);
}

/**
 * Store settings (whatsapp + AI config) from Firebase, falling back to the
 * local settings.js. Always async to match getParts().
 *
 * @returns {Promise<Object>}
 */
async function getSettings() {
  const FB = globalThis.ItqanFB;
  if (FB && FB.ready()) {
    try {
      const snap = await FB.db().ref('settings').once('value');
      const val = snap.val();
      if (val) return val;
    } catch (e) {
      console.warn('Firebase settings read failed — using local settings.js', e);
    }
  }
  return structuredClone(globalThis.ITQAN_SETTINGS || {});
}

/* Allow the pure-data module to be imported in Node for testing. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PARTS_DB, CATEGORY_META, CATEGORY_ORDER, getParts, getSettings, normalizeInventory };
}
