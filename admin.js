/**
 * =============================================================================
 * ITQAN STORE — LOCAL INVENTORY CONSOLE (admin.js)
 * =============================================================================
 * A zero-backend admin dashboard for the store owner:
 *   - Sidebar category nav + a global "all parts" view + name/id search.
 *   - A detailed data TABLE: every spec field shown in its own column.
 *   - Sort by name / price, add / edit / duplicate / delete.
 *   - Live dashboard stats (count, value, avg, photo & description coverage).
 *   - Store settings (WhatsApp number) editable from the panel.
 *   - Saves DIRECTLY into the project via the File System Access API:
 *       inventory.js      -> regenerated on every change
 *       settings.js       -> written when settings change
 *       images/<id>.<ext> -> photo copied automatically
 *   - Fallback (API unavailable / folder not connected): download the files
 *     and copy photos by the shown filename.
 *
 * Local-only for the owner; never linked from the store.
 * =============================================================================
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ state */
  const FB = globalThis.ItqanFB;
  const fbMode = !!(FB && FB.ready());   // cloud (Firebase) vs local (files) mode
  let loggedIn = false;

  // sha256('123') — the default admin password hash (user can change it in-app).
  // mode: 'user' (username + password) or 'code' (PIN only).
  const DEFAULT_ADMIN = { mode: 'user', user: '123', passHash: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3' };
  let credMode = 'user';   // selected mode inside the credentials dialog

  function emptyDB() { const o = {}; CATEGORY_ORDER.forEach((c) => { o[c] = []; }); return o; }

  let db = fbMode ? emptyDB() : structuredClone(globalThis.ITQAN_INVENTORY);
  let settings = structuredClone(globalThis.ITQAN_SETTINGS || { whatsappPhone: '' });
  if (!settings.ai) settings.ai = { provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: '' };

  /** المساعد مثبّت على Claude فقط (Anthropic). لا يمكن تغيير المزوّد. */
  const AI_PROVIDERS = {
    anthropic: {
      label: 'Anthropic — Claude',
      models: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-4-8'],
      hint: 'الأفضل استخدام الخادم الوسيط بالأعلى. هذا المفتاح المباشر احتياطي فقط (يبدأ بـ sk-ant-…).',
    },
  };
  let view = 'cpu';            // category key | 'all'
  let query = '';             // search text ('' = browse)
  let sortMode = 'name';      // 'name' | 'price-asc' | 'price-desc'
  let dirHandle = null;
  let editingId = null;
  let editingCat = null;      // category of the part being edited
  let pickedImageFile = null;
  let toastTimer = null;

  const $ = (s) => document.querySelector(s);
  const CAT_AR = (cat) => CATEGORY_META[cat].label.ar;

  const nf = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 0 });
  const fmtSAR = (n) => `${nf.format(n)} ر.س`;

  function esc(str) {
    return String(str)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function toast(msg) {
    clearTimeout(toastTimer);
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-visible');
    toastTimer = setTimeout(() => t.classList.remove('is-visible'), 3400);
  }

  /* ======================================================================
   * SCHEMAS — form inputs (FIELDS) + table columns (COLUMNS) per category
   * ==================================================================== */
  const SOCKETS = ['AM4', 'AM5', 'LGA1700', 'LGA1851', 'LGA1200', 'sTR5'];
  const FIELDS = {
    cpu: [
      { k: 'socket', t: 'select', label: 'السوكت *', options: SOCKETS, req: true },
      { k: 'tdpWatts', t: 'number', label: 'استهلاك الطاقة (واط) *', req: true },
      { k: 'integratedGraphics', t: 'check', label: 'فيه رسوميات مدمجة (iGPU)' },
    ],
    motherboard: [
      { k: 'socket', t: 'select', label: 'السوكت *', options: SOCKETS, req: true },
      { k: 'ramType', t: 'select', label: 'نوع الذاكرة *', options: ['DDR4', 'DDR5'], req: true },
      { k: 'formFactor', t: 'select', label: 'المقاس *', options: ['ATX', 'mATX', 'Mini-ITX'], req: true },
    ],
    gpu: [
      { k: 'powerDraw', t: 'number', label: 'استهلاك الطاقة (واط) *', req: true },
      { k: 'recommendedPSU', t: 'number', label: 'المزود المقترح (واط) *', req: true },
    ],
    ram: [
      { k: 'type', t: 'select', label: 'النوع *', options: ['DDR4', 'DDR5'], req: true },
      { k: 'capacity', t: 'text', label: 'السعة *', ph: '32GB (2×16)', req: true },
      { k: 'speed', t: 'text', label: 'السرعة *', ph: 'DDR5-6000', req: true },
    ],
    storage: [
      { k: 'type', t: 'select', label: 'النوع *', options: ['NVMe', 'SATA'], req: true },
      { k: 'capacity', t: 'text', label: 'السعة *', ph: '1TB', req: true },
    ],
    psu: [
      { k: 'wattage', t: 'number', label: 'القدرة (واط) *', req: true },
      { k: 'rating', t: 'select', label: 'شهادة الكفاءة *', options: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Titanium'], req: true },
    ],
    case: [
      { k: 'formFactorSupport', t: 'checks', label: 'مقاسات اللوحات المدعومة *', options: ['ATX', 'mATX', 'Mini-ITX'], req: true },
    ],
    cooler: [
      { k: 'tdpSupport', t: 'number', label: 'أقصى تبريد (واط TDP) *', req: true },
    ],
  };

  /** Column definitions per category (header label + how to render the cell). */
  const COLUMNS = {
    cpu: [
      { k: 'socket', label: 'السوكت', kind: 'mono' },
      { k: 'tdpWatts', label: 'الطاقة', kind: 'watt' },
      { k: 'integratedGraphics', label: 'رسوميات', kind: 'bool', on: 'iGPU', off: '—' },
    ],
    motherboard: [
      { k: 'socket', label: 'السوكت', kind: 'mono' },
      { k: 'ramType', label: 'الذاكرة', kind: 'mono' },
      { k: 'formFactor', label: 'المقاس', kind: 'mono' },
    ],
    gpu: [
      { k: 'powerDraw', label: 'الطاقة', kind: 'watt' },
      { k: 'recommendedPSU', label: 'مزود مقترح', kind: 'watt' },
    ],
    ram: [
      { k: 'type', label: 'النوع', kind: 'mono' },
      { k: 'capacity', label: 'السعة', kind: 'mono' },
      { k: 'speed', label: 'السرعة', kind: 'mono' },
    ],
    storage: [
      { k: 'type', label: 'النوع', kind: 'mono' },
      { k: 'capacity', label: 'السعة', kind: 'mono' },
    ],
    psu: [
      { k: 'wattage', label: 'القدرة', kind: 'watt' },
      { k: 'rating', label: 'الكفاءة', kind: 'mono' },
    ],
    case: [
      { k: 'formFactorSupport', label: 'المقاسات المدعومة', kind: 'list' },
    ],
    cooler: [
      { k: 'tdpSupport', label: 'أقصى تبريد', kind: 'watt' },
    ],
  };

  /** Render one spec cell's inner HTML based on its column kind. */
  function cellValue(col, p) {
    const v = p[col.k];
    switch (col.kind) {
      case 'watt': return `<span class="cell-mono">${esc(v)} <small style="opacity:.6">واط</small></span>`;
      case 'mono': return `<span class="pill pill--spec">${esc(v)}</span>`;
      case 'bool': return `<span class="pill pill--bool">${v ? esc(col.on) : esc(col.off)}</span>`;
      case 'list': return `<span class="cell-chips">${(v || []).map((x) => `<span class="pill pill--spec">${esc(x)}</span>`).join('')}</span>`;
      default: return esc(v ?? '');
    }
  }

  /* ======================================================================
   * PROJECT FOLDER CONNECTION (File System Access API)
   * ==================================================================== */
  const fsSupported = 'showDirectoryPicker' in window;

  async function connectFolder() {
    if (!fsSupported) { toast('متصفحك لا يدعم الحفظ المباشر — استخدم «تنزيل نسخة»'); return; }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await handle.getFileHandle('inventory.js'); // sanity: is this the project folder?
      dirHandle = handle;
      document.body.classList.add('is-connected');
      $('#connTitle').textContent = 'المجلد مربوط';
      $('#connSub').textContent = 'الحفظ تلقائي ✓';
      toast('تم ربط مجلد المشروع ✓ — كل تعديل يُحفظ مباشرة');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast('هذا ليس مجلد المشروع — اختر المجلد الذي فيه inventory.js');
    }
  }

  function serializeInventory() {
    const header = [
      '/**',
      ' * =============================================================================',
      ' * ITQAN STORE — INVENTORY (inventory.js)',
      ' * =============================================================================',
      ' * MACHINE-GENERATED by admin.html — do not hand-edit unless you must.',
      ' * =============================================================================',
      ' */',
      'globalThis.ITQAN_INVENTORY = ',
    ].join('\n');
    return header + JSON.stringify(db, null, 2) + ';\n';
  }

  async function writeInventory() {
    if (fbMode) { await FB.db().ref('itqan/inventory').set(db); return true; }
    if (!dirHandle) return false;
    const fh = await dirHandle.getFileHandle('inventory.js', { create: true });
    const w = await fh.createWritable();
    await w.write(serializeInventory());
    await w.close();
    return true;
  }

  /** Resize + compress an image file to a small JPEG data URL (browser canvas). */
  function fileToDataURL(file, maxDim = 900, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (Math.max(width, height) > maxDim) {
          const s = maxDim / Math.max(width, height);
          width = Math.round(width * s); height = Math.round(height * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  }

  async function saveImage(file, partId) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    // Cloud mode: store a compressed inline data URL in the database itself.
    // Avoids Firebase Storage (which needs auth + the Blaze plan) entirely, so
    // images always show on the customer page with no extra setup.
    if (fbMode) {
      return await fileToDataURL(file);
    }
    // Local mode: copy the file into the project's images/ folder.
    const path = `images/${partId}.${ext}`;
    if (dirHandle) {
      const imgDir = await dirHandle.getDirectoryHandle('images', { create: true });
      const fh = await imgDir.getFileHandle(`${partId}.${ext}`, { create: true });
      const w = await fh.createWritable();
      await w.write(file);
      await w.close();
    } else {
      toast(`احفظ الصورة يدويًا باسم: ${path}`);
    }
    return path;
  }

  function downloadFile(name, text) {
    const blob = new Blob([text], { type: 'text/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadInventory() {
    downloadFile('inventory.js', serializeInventory());
    toast('نزّل الملف واستبدل inventory.js في مجلد المشروع');
  }

  /* ======================================================================
   * STORE SETTINGS (settings.js)
   * ==================================================================== */
  function serializeSettings() {
    return [
      '/**',
      ' * =============================================================================',
      ' * ITQAN STORE — STORE SETTINGS (settings.js)',
      ' * =============================================================================',
      ' * MACHINE-GENERATED by admin.html (إعدادات المتجر) — يمكن تعديله يدويًا.',
      ' * whatsappPhone: رقم واتساب المتجر بصيغة دولية بدون + (مثال: 966512345678)',
      ' * =============================================================================',
      ' */',
      'globalThis.ITQAN_SETTINGS = ' + JSON.stringify(settings, null, 2) + ';',
      '',
    ].join('\n');
  }

  /** Fill the Claude model dropdown (provider is locked to Anthropic). */
  function renderModelOptions(selected) {
    const cfg = AI_PROVIDERS.anthropic;
    $('#setModel').innerHTML = cfg.models
      .map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${m}</option>`).join('');
    if (!cfg.models.includes(selected)) $('#setModel').value = cfg.models[0];
    $('#keyHint').textContent = cfg.hint;
  }

  function fillSettingsForm() {
    $('#setWhatsapp').value = settings.whatsappPhone || '';
    const ai = settings.ai || {};
    renderModelOptions(ai.model);
    $('#setProxyUrl').value = ai.proxyUrl || '';
    $('#setApiKey').value = ai.apiKey || '';
  }

  async function saveSettings() {
    const phone = $('#setWhatsapp').value.replace(/[^0-9]/g, '');
    if (phone.length < 10) { toast('اكتب رقمًا دوليًا صحيحًا، مثال: 966512345678'); return; }
    settings.whatsappPhone = phone;
    settings.ai = {
      provider: 'anthropic',                 // locked — Claude only
      model: $('#setModel').value,
      proxyUrl: $('#setProxyUrl').value.trim(),
      apiKey: $('#setApiKey').value.trim(),
    };
    try {
      if (fbMode) {
        await FB.db().ref('itqan/settings').set(settings);
        toast('تم حفظ الإعدادات في Firebase ✓');
      } else if (dirHandle) {
        const fh = await dirHandle.getFileHandle('settings.js', { create: true });
        const w = await fh.createWritable();
        await w.write(serializeSettings());
        await w.close();
        toast('تم حفظ الإعدادات في الموقع ✓');
      } else {
        downloadFile('settings.js', serializeSettings());
        toast('نزّل settings.js واستبدله في مجلد المشروع');
      }
      $('#settingsDialog').close();
    } catch (err) {
      console.error(err);
      toast('تعذّر حفظ الإعدادات');
    }
  }

  /* ======================================================================
   * DERIVED DATA
   * ==================================================================== */
  const isPlaceholder = (p, cat) => !p.image || p.image === CATEGORY_META[cat].icon;
  const allRows = () => CATEGORY_ORDER.flatMap((c) => db[c].map((p) => ({ p, cat: c })));

  /** Rows for the current view (search overrides category). */
  function visibleRows() {
    let rows;
    if (query) {
      const q = query.toLowerCase();
      rows = allRows().filter(({ p }) => p.name.toLowerCase().includes(q) || p.id.includes(q));
    } else if (view === 'all') {
      rows = allRows();
    } else {
      rows = db[view].map((p) => ({ p, cat: view }));
    }
    if (sortMode === 'price-asc') rows.sort((a, b) => a.p.price - b.p.price);
    else if (sortMode === 'price-desc') rows.sort((a, b) => b.p.price - a.p.price);
    else rows.sort((a, b) => a.p.name.localeCompare(b.p.name, 'en'));
    return rows;
  }

  /* ======================================================================
   * RENDER — sidebar nav
   * ==================================================================== */
  const CAT_ICON = {
    cpu: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    motherboard: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="6" height="6"/><path d="M16 7v4M16 15h2"/>',
    gpu: '<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="8" cy="12" r="2.4"/><circle cx="15" cy="12" r="2.4"/>',
    ram: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 16v2M11 16v2M15 16v2M19 16v2"/>',
    storage: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h5M8 12h8"/><circle cx="16.5" cy="16" r="1"/>',
    psu: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="9" cy="12" r="3"/><path d="M15 10h3M15 14h3"/>',
    case: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 6h6M9 9h6"/><circle cx="12" cy="15" r="2"/>',
    cooler: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
  };

  function renderNav() {
    const items = CATEGORY_ORDER.map((cat) => ({
      key: cat, label: CAT_AR(cat), count: db[cat].length, ico: CAT_ICON[cat],
    }));
    items.push({ key: 'all', label: 'كل القطع', count: allRows().length,
      ico: '<path d="M4 6h16M4 12h16M4 18h16"/>' });

    $('#sideNav').innerHTML = items.map((it) => `
      <button type="button" class="nav-item ${it.key === view && !query ? 'is-active' : ''}" data-view="${it.key}">
        <span class="nav-item__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${it.ico}</svg></span>
        <span class="nav-item__label">${esc(it.label)}</span>
        <span class="nav-item__count">${nf.format(it.count)}</span>
      </button>`).join('');
  }

  /* ======================================================================
   * RENDER — stats
   * ==================================================================== */
  function renderStats() {
    const all = allRows();
    const totalValue = all.reduce((s, { p }) => s + p.price, 0);
    const withPhoto = all.filter(({ p, cat }) => !isPlaceholder(p, cat)).length;
    const noBlurb = all.filter(({ p }) => !p.blurb || !p.blurb.ar).length;

    $('#statsRow').innerHTML = `
      <div class="stat"><b>${nf.format(all.length)}</b><span>إجمالي القطع</span><code>PARTS</code></div>
      <div class="stat"><b>${fmtSAR(totalValue)}</b><span>قيمة المخزون الكاملة</span><code>VALUE</code></div>
      <div class="stat"><b>${withPhoto}<small style="font-size:.8rem;color:var(--text-2)">/${all.length}</small></b><span>قطع بصور حقيقية</span><code>PHOTOS</code></div>
      <div class="stat"><b>${nf.format(noBlurb)}</b><span>قطع بلا وصف عربي</span><code>TODO</code></div>`;
  }

  /* ======================================================================
   * RENDER — table
   * ==================================================================== */
  function renderTable() {
    const rows = visibleRows();
    const single = !query && view !== 'all';

    // Title + meta line
    $('#viewTitle').textContent = query ? 'نتائج البحث' : (view === 'all' ? 'كل القطع' : CAT_AR(view));
    $('#viewMeta').textContent = query ? `«${query}»` : (single ? `CATEGORY / ${view.toUpperCase()}` : 'ALL CATEGORIES');
    $('#tblTitle').textContent = query ? `${rows.length} نتيجة` : (view === 'all' ? 'كل القطع' : CAT_AR(view));

    // Meta: count · avg · range
    if (rows.length) {
      const prices = rows.map((r) => r.p.price);
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      $('#tblMeta').textContent = `${rows.length} قطعة · متوسط ${fmtSAR(avg)} · من ${fmtSAR(Math.min(...prices))} إلى ${fmtSAR(Math.max(...prices))}`;
    } else {
      $('#tblMeta').textContent = '';
    }

    // Header columns
    const specCols = single ? COLUMNS[view] : null;
    const heads = ['المنتج', 'المعرّف'];
    if (single) specCols.forEach((c) => heads.push(c.label));
    else heads.push('الفئة', 'المواصفات');
    heads.push('السعر', 'الصورة', '');
    $('#tblHead').innerHTML = '<tr>' + heads.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';

    if (!rows.length) {
      $('#tblBody').innerHTML = `<tr><td colspan="${heads.length}"><div class="empty">${query ? 'لا توجد نتائج — جرّب اسمًا آخر' : 'لا توجد قطع في هذه الفئة بعد — اضغط «إضافة قطعة»'}</div></td></tr>`;
      return;
    }

    $('#tblBody').innerHTML = rows.map(({ p, cat }) => {
      const placeholder = isPlaceholder(p, cat);
      const prodCell = `
        <td>
          <div class="cell-prod">
            <img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(CATEGORY_META[cat].icon)}'">
            <div class="cell-prod__t">
              <span class="cell-prod__name">${esc(p.name)}</span>
              ${p.blurb && p.blurb.ar ? `<span class="cell-prod__blurb">${esc(p.blurb.ar)}</span>` : ''}
            </div>
          </div>
        </td>`;
      const idCell = `<td><span class="cell-id">${esc(p.id)}</span></td>`;

      let specCells;
      if (single) {
        specCells = specCols.map((c) => `<td>${cellValue(c, p)}</td>`).join('');
      } else {
        const chips = COLUMNS[cat].map((c) => {
          const v = p[c.k];
          const text = c.kind === 'watt' ? `${v} واط` : c.kind === 'bool' ? (v ? c.on : c.off) : c.kind === 'list' ? (v || []).join('/') : v;
          return `<span class="pill pill--spec">${esc(text)}</span>`;
        }).join('');
        specCells = `<td><span class="pill pill--cat">${esc(CAT_AR(cat))}</span></td><td><span class="cell-chips">${chips}</span></td>`;
      }

      const priceCell = `<td><span class="cell-price">${fmtSAR(p.price)}</span></td>`;
      const imgCell = `<td><span class="pill ${placeholder ? 'pill--n' : 'pill--y'}">${placeholder ? 'مؤقتة' : '✓ حقيقية'}</span></td>`;
      const actions = `
        <td>
          <div class="row-actions">
            <button type="button" class="rb" data-edit="${p.id}" data-cat="${cat}" aria-label="تعديل ${esc(p.name)}" title="تعديل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
            <button type="button" class="rb" data-dup="${p.id}" data-cat="${cat}" aria-label="نسخ ${esc(p.name)}" title="نسخ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg></button>
            <button type="button" class="rb rb--del" data-del="${p.id}" data-cat="${cat}" aria-label="حذف ${esc(p.name)}" title="حذف"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2m1 0-1 14H8L7 6"/></svg></button>
          </div>
        </td>`;

      return `<tr>${prodCell}${idCell}${specCells}${priceCell}${imgCell}${actions}</tr>`;
    }).join('');
  }

  function renderAll() {
    renderNav();
    renderStats();
    renderTable();
  }

  /* ======================================================================
   * ID GENERATION
   * ==================================================================== */
  function slugify(name) {
    const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return s || `part-${Date.now().toString(36)}`;
  }
  function uniqueId(cat, name) {
    const base = `${cat}-${slugify(name)}`;
    let id = base, n = 2;
    while (db[cat].some((p) => p.id === id)) id = `${base}-${n++}`;
    return id;
  }

  /* ======================================================================
   * FORM
   * ==================================================================== */
  function fieldHtml(f, value) {
    const v = value === undefined || value === null ? '' : value;
    switch (f.t) {
      case 'number':
        return `<div class="field"><label for="f_${f.k}">${f.label}</label><input type="number" id="f_${f.k}" min="0" ${f.req ? 'required' : ''} value="${esc(v)}"></div>`;
      case 'text':
        return `<div class="field"><label for="f_${f.k}">${f.label}</label><input type="text" id="f_${f.k}" dir="ltr" placeholder="${esc(f.ph || '')}" ${f.req ? 'required' : ''} value="${esc(v)}"></div>`;
      case 'list':
        return `<div class="field"><label for="f_${f.k}">${f.label}</label><input type="text" id="f_${f.k}" dir="ltr" list="dl_${f.k}" ${f.req ? 'required' : ''} value="${esc(v)}"><datalist id="dl_${f.k}">${f.list.map((o) => `<option value="${o}">`).join('')}</datalist></div>`;
      case 'select':
        return `<div class="field"><label for="f_${f.k}">${f.label}</label><select id="f_${f.k}">${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
      case 'check':
        return `<div class="field"><label class="field-check"><input type="checkbox" id="f_${f.k}" ${v ? 'checked' : ''}> ${f.label}</label></div>`;
      case 'checks':
        return `<div class="field"><label>${f.label}</label><div class="checks">${f.options.map((o) => `<label class="field-check"><input type="checkbox" data-checks="${f.k}" value="${o}" ${(v || []).includes(o) ? 'checked' : ''}> ${o}</label>`).join('')}</div></div>`;
      default: return '';
    }
  }

  /** Category the form is currently working in: locked to the part when
   *  editing, otherwise driven by the in-form type selector. */
  function formCat() {
    return editingId ? editingCat : $('#fCat').value;
  }

  /** (Re)build the spec fields for a category; keep values if a part is given. */
  function renderDynFields(cat, part) {
    $('#dynTitle').textContent = `المواصفات التقنية — ${CAT_AR(cat)}`;
    $('#dynFields').innerHTML = FIELDS[cat]
      .map((f) => fieldHtml(f, part ? part[f.k] : undefined)).join('');
  }

  function openForm(part, cat) {
    editingId = part ? part.id : null;
    editingCat = part ? cat : (view !== 'all' ? view : 'cpu');
    pickedImageFile = null;
    const c = editingCat; // resolved directly; #fCat isn't populated yet

    // Populate the type selector (first field).
    $('#fCat').innerHTML = CATEGORY_ORDER
      .map((k) => `<option value="${k}" ${k === c ? 'selected' : ''}>${esc(CAT_AR(k))}</option>`).join('');
    // Category is fixed while editing (its id + fields belong to it).
    $('#fCat').disabled = !!editingId;
    $('#catField').classList.toggle('is-locked', !!editingId);
    $('#catNote').textContent = editingId
      ? 'لا يمكن تغيير نوع القطعة بعد إنشائها — احذفها وأضِفها من جديد إذا لزم.'
      : 'اختر النوع أولًا — ستظهر الحقول المناسبة له تلقائيًا';

    $('#pdTitle').textContent = part ? `تعديل: ${part.name}` : 'إضافة قطعة جديدة';
    $('#fName').value = part ? part.name : '';
    $('#fPrice').value = part ? part.price : '';
    $('#fBlurbAr').value = part && part.blurb ? (part.blurb.ar || '') : '';
    $('#fBlurbEn').value = part && part.blurb ? (part.blurb.en || '') : '';
    $('#fImage').value = '';
    $('#imgPreview').src = part ? part.image : CATEGORY_META[c].icon;
    $('#imgHint').textContent = 'اضغط لاختيار صورة من جهازك — تُنسخ تلقائيًا لمجلد الصور';

    renderDynFields(c, part);

    $('#partDialog').showModal();
    $('#fName').focus();
  }

  function collectForm() {
    const c = formCat();
    const name = $('#fName').value.trim();
    const price = Number($('#fPrice').value);
    if (!name) { toast('اكتب اسم القطعة'); return null; }
    if (!price || price < 1) { toast('اكتب سعرًا صحيحًا'); return null; }

    const part = editingId
      ? structuredClone(db[c].find((p) => p.id === editingId))
      : { id: uniqueId(c, name), image: CATEGORY_META[c].icon, blurb: { ar: '', en: '' } };

    part.name = name;
    part.price = price;
    part.blurb = { ar: $('#fBlurbAr').value.trim(), en: $('#fBlurbEn').value.trim() };

    for (const f of FIELDS[c]) {
      if (f.t === 'checks') {
        const vals = [...document.querySelectorAll(`[data-checks="${f.k}"]:checked`)].map((x) => x.value);
        if (f.req && vals.length === 0) { toast(`اختر ${f.label.replace(' *', '')}`); return null; }
        part[f.k] = vals;
      } else if (f.t === 'check') {
        part[f.k] = $(`#f_${f.k}`).checked;
      } else if (f.t === 'number') {
        const n = Number($(`#f_${f.k}`).value);
        if (f.req && (!n || n < 0)) { toast(`أدخل ${f.label.replace(' *', '')}`); return null; }
        part[f.k] = n;
      } else {
        const val = $(`#f_${f.k}`).value.trim();
        if (f.req && !val) { toast(`أدخل ${f.label.replace(' *', '')}`); return null; }
        part[f.k] = val;
      }
    }
    return part;
  }

  async function saveForm() {
    const c = formCat();
    const part = collectForm();
    if (!part) return;
    try {
      if (pickedImageFile) part.image = await saveImage(pickedImageFile, part.id);
      if (editingId) {
        const i = db[c].findIndex((p) => p.id === editingId);
        db[c][i] = part;
      } else {
        db[c].push(part);
      }
      const saved = await writeInventory();
      $('#partDialog').close();
      renderAll();
      toast(saved ? `تم الحفظ في ملفات الموقع ✓ — ${part.name}` : 'أُضيفت بالذاكرة — نزّل inventory.js لحفظها');
    } catch (err) {
      console.error(err);
      toast('تعذّر الحفظ — تأكد من ربط مجلد المشروع الصحيح');
    }
  }

  async function duplicatePart(cat, id) {
    const src = db[cat].find((p) => p.id === id);
    if (!src) return;
    const copy = structuredClone(src);
    copy.name = `${src.name} (نسخة)`;
    copy.id = uniqueId(cat, copy.name);
    db[cat].push(copy);
    await writeInventory().catch(() => false);
    renderAll();
    openForm(copy, cat); // open the copy so the owner can tweak it immediately
    toast('تم إنشاء نسخة — عدّل تفاصيلها ثم احفظ');
  }

  async function deletePart(cat, id) {
    const part = db[cat].find((p) => p.id === id);
    if (!part) return;
    if (!confirm(`حذف «${part.name}» نهائيًا؟`)) return;
    db[cat] = db[cat].filter((p) => p.id !== id);
    const saved = await writeInventory().catch(() => false);
    renderAll();
    toast(saved ? 'تم الحذف والحفظ ✓' : 'حُذفت بالذاكرة — نزّل inventory.js لحفظها');
  }

  /* ======================================================================
   * EVENTS + BOOT
   * ==================================================================== */
  /** Read inventory + settings straight from Firebase (empty cloud = empty). */
  async function loadFromCloud() {
    try {
      const inv = await FB.db().ref('itqan/inventory').once('value');
      db = normalizeInv(inv.val());
      const st = await FB.db().ref('itqan/settings').once('value');
      settings = st.val() || structuredClone(globalThis.ITQAN_SETTINGS || {});
      if (!settings.ai) settings.ai = { provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: '' };
      settings.ai.provider = 'anthropic';   // enforce Claude-only even on old cloud data
      renderAll();
    } catch (e) {
      console.error(e);
      toast('تعذّر تحميل البيانات من Firebase — تحقق من القواعد');
    }
  }

  function normalizeInv(val) {
    const o = {};
    CATEGORY_ORDER.forEach((c) => {
      const a = val && val[c];
      o[c] = Array.isArray(a) ? a.filter(Boolean)
        : (a && typeof a === 'object' ? Object.values(a).filter(Boolean) : []);
    });
    return o;
  }

  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Effective admin credentials: Firebase settings/admin → local → default. */
  async function readAdminCreds() {
    if (fbMode) {
      try {
        const snap = await FB.db().ref('settings/admin').once('value');
        const v = snap.val();
        if (v && v.user) return v;
      } catch (e) { /* public read may fail before rules set — fall through */ }
    }
    const local = globalThis.ITQAN_SETTINGS && globalThis.ITQAN_SETTINGS.admin;
    return (local && local.user) ? local : DEFAULT_ADMIN;
  }

  async function seedToFirebase() {
    if (!confirm('سيتم رفع بيانات inventory.js و settings.js المحلية إلى Firebase (تكتب فوق الموجود). متابعة؟')) return;
    try {
      await FB.db().ref('itqan/inventory').set(structuredClone(globalThis.ITQAN_INVENTORY));
      await FB.db().ref('itqan/settings').set(structuredClone(globalThis.ITQAN_SETTINGS || {}));
      toast('تم رفع البيانات المحلية إلى Firebase ✓');
      loadFromCloud();
    } catch (e) {
      console.error(e);
      toast('تعذّر الرفع — تأكد من تسجيل الدخول وقواعد الأمان');
    }
  }

  /** Login gate reflects the saved mode: hide the username field for PIN mode. */
  function applyLoginMode(mode) {
    const isCode = mode === 'code';
    $('#loginUser').hidden = isCode;
    $('#loginPass').placeholder = isCode ? 'الكود' : 'كلمة المرور';
    $('#loginPass').setAttribute('inputmode', isCode ? 'numeric' : 'text');
  }

  /** Credentials dialog UI reflects the selected mode. */
  function applyCredMode(mode) {
    credMode = mode;
    document.querySelectorAll('#credMode .seg-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    });
    const isCode = mode === 'code';
    $('#credUserField').hidden = isCode;
    $('#credPassLabel').textContent = isCode ? 'الكود الجديد (PIN)' : 'كلمة المرور الجديدة';
    $('#credPass').placeholder = isCode ? 'مثال: 4526' : 'اكتب كلمة مرور جديدة';
    $('#credPass').setAttribute('inputmode', isCode ? 'numeric' : 'text');
  }

  /** Save new admin credentials (hashed) to Firebase / local settings. */
  async function saveCreds() {
    const p = $('#credPass').value;
    const isCode = credMode === 'code';
    if (!p) { toast(isCode ? 'اكتب الكود' : 'اكتب كلمة المرور'); return; }
    let user = '';
    if (!isCode) {
      user = $('#credUser').value.trim();
      if (!user) { toast('اكتب اسم المستخدم'); return; }
    }
    const admin = { mode: credMode, user, passHash: await sha256(p) };
    try {
      if (fbMode) {
        await FB.db().ref('settings/admin').set(admin);
      } else if (dirHandle) {
        settings.admin = admin;
        const fh = await dirHandle.getFileHandle('settings.js', { create: true });
        const w = await fh.createWritable();
        await w.write(serializeSettings());
        await w.close();
      } else {
        settings.admin = admin;
        downloadFile('settings.js', serializeSettings());
        toast('نزّل settings.js واستبدله في مجلد المشروع');
      }
      settings.admin = admin;
      if (globalThis.ITQAN_SETTINGS) globalThis.ITQAN_SETTINGS.admin = admin;
      $('#credsDialog').close();
      toast('تم تحديث بيانات الدخول ✓');
    } catch (e) {
      console.error(e);
      toast('تعذّر حفظ بيانات الدخول');
    }
  }

  function afterUnlock() {
    loggedIn = true;
    $('#loginGate').hidden = true;
    $('#logoutBtn').hidden = false;
    $('#credsBtn').hidden = false;
    document.body.classList.add('is-connected');
    if (fbMode) {
      $('#connTitle').textContent = 'متصل بـ Firebase';
      $('#connSub').textContent = 'مسجّل الدخول';
      loadFromCloud();
    } else {
      renderAll();
    }
  }

  function lock() {
    loggedIn = false;
    if (fbMode) FB.auth().signOut().catch(() => {});
    $('#loginPass').value = '';
    $('#loginGate').hidden = false;
    document.body.classList.remove('is-connected');
  }

  /** App-level login gate — default 123/123, changeable in-app.
   *  In Firebase mode, a successful login also signs in anonymously so writes
   *  satisfy the `auth != null` security rules. */
  function setupGate() {
    if (fbMode) {
      $('#connectBtn').style.display = 'none';   // folder-connect is local-mode only
      $('#exportBtn2').style.display = 'none';
      $('#seedBtn').hidden = false;
      $('#seedBtn').addEventListener('click', seedToFirebase);
    }
    $('#logoutBtn').addEventListener('click', lock);
    $('#loginGate').hidden = false;   // always require login on load
    readAdminCreds().then((c) => applyLoginMode(c.mode || 'user'));

    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#loginErr').textContent = '';
      let h;
      try { h = await sha256($('#loginPass').value); }
      catch { $('#loginErr').textContent = 'المتصفح لا يدعم التشفير — افتح الموقع عبر https أو localhost'; return; }
      const creds = await readAdminCreds();
      const mode = creds.mode || 'user';
      const userOk = mode === 'code' ? true : ($('#loginUser').value.trim() === creds.user);
      if (!userOk || h !== creds.passHash) {
        $('#loginErr').textContent = mode === 'code' ? 'الكود غير صحيح' : 'اسم المستخدم أو كلمة المرور غير صحيحة';
        return;
      }
      if (fbMode) {
        // Try anonymous sign-in (needed only if DB rules require auth to write).
        // If it's disabled, DON'T block: while the rules are open (test mode)
        // writes still succeed. To harden later, enable Anonymous sign-in +
        // publish the locked rules from FIREBASE-SETUP.md.
        try { await FB.auth().signInAnonymously(); }
        catch (err) { console.warn('Anonymous sign-in unavailable — continuing with open rules.', err); }
      }
      afterUnlock();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#setWhatsapp').value = settings.whatsappPhone || '';

    setupGate();   // login required in both modes; renders dashboard on unlock
    if (!fbMode) {
      if (!fsSupported) {
        $('#connTitle').textContent = 'الحفظ المباشر غير مدعوم';
        $('#connSub').textContent = 'استخدم «تنزيل نسخة»';
        $('#connectBtn').disabled = true;
      }
      $('#connectBtn').addEventListener('click', connectFolder);
      $('#exportBtn2').addEventListener('click', downloadInventory);
    }

    // change-credentials dialog
    $('#credsBtn').addEventListener('click', () => {
      $('#credUser').value = ''; $('#credPass').value = '';
      const cur = (settings.admin && settings.admin.mode)
        || (globalThis.ITQAN_SETTINGS && globalThis.ITQAN_SETTINGS.admin && globalThis.ITQAN_SETTINGS.admin.mode)
        || 'user';
      applyCredMode(cur);
      $('#credsDialog').showModal();
    });
    document.querySelectorAll('#credMode .seg-btn').forEach((b) =>
      b.addEventListener('click', () => applyCredMode(b.dataset.mode)));
    $('#credsForm').addEventListener('submit', (e) => { e.preventDefault(); saveCreds(); });
    $('#credsCancel').addEventListener('click', () => $('#credsDialog').close());
    $('#credsClose').addEventListener('click', () => $('#credsDialog').close());

    $('#addBtn').addEventListener('click', () => { openForm(null); });

    $('#settingsBtn').addEventListener('click', () => { fillSettingsForm(); $('#settingsDialog').showModal(); });
    $('#settingsForm').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
    $('#setCancel').addEventListener('click', () => $('#settingsDialog').close());
    $('#setClose').addEventListener('click', () => $('#settingsDialog').close());
    // provider is locked to Claude — no provider selector to wire up

    $('#searchInput').addEventListener('input', (e) => { query = e.target.value.trim(); renderNav(); renderTable(); });
    $('#sortSel').addEventListener('change', (e) => { sortMode = e.target.value; renderTable(); });

    $('#sideNav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (!b) return;
      view = b.dataset.view;
      query = '';
      $('#searchInput').value = '';
      renderAll();
    });

    $('#tblBody').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) { openForm(db[edit.dataset.cat].find((p) => p.id === edit.dataset.edit), edit.dataset.cat); return; }
      const dup = e.target.closest('[data-dup]');
      if (dup) { duplicatePart(dup.dataset.cat, dup.dataset.dup); return; }
      const del = e.target.closest('[data-del]');
      if (del) deletePart(del.dataset.cat, del.dataset.del);
    });

    $('#partForm').addEventListener('submit', (e) => { e.preventDefault(); saveForm(); });
    $('#pdCancel').addEventListener('click', () => $('#partDialog').close());
    $('#pdClose').addEventListener('click', () => $('#partDialog').close());

    // Changing the type (add mode) swaps the spec fields + placeholder image.
    $('#fCat').addEventListener('change', () => {
      if (editingId) return; // locked while editing
      const c = $('#fCat').value;
      if (!pickedImageFile) $('#imgPreview').src = CATEGORY_META[c].icon;
      renderDynFields(c, null);
    });

    $('#fImage').addEventListener('change', () => {
      const f = $('#fImage').files[0];
      if (!f) return;
      pickedImageFile = f;
      $('#imgPreview').src = URL.createObjectURL(f);
      $('#imgHint').textContent = `تم اختيار: ${f.name}`;
    });
  });
})();
