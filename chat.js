/**
 * =============================================================================
 * ITQAN STORE — AI BUILD ASSISTANT (chat.js)
 * =============================================================================
 * Floating, bilingual chat widget. The AI provider, model, and API key are
 * configured ONCE by the store owner in admin.html (→ settings.js), so the
 * assistant works for every visitor without them entering anything.
 *
 * LOCKED TO CLAUDE (Anthropic). Customers cannot change provider, model, or key.
 *
 * Two request modes (chosen by store settings):
 *   - proxy  → POST to a Cloudflare Worker that holds the key server-side.
 *              The browser never sees the key. This is the secure default.
 *   - direct → legacy fallback: the key travels from the browser (exposed).
 *
 * The owner configures the proxy URL (or key) ONCE in admin.html → settings,
 * so the assistant works for every visitor without them entering anything.
 * =============================================================================
 */
(function () {
  'use strict';

  const MAX_HISTORY = 12;
  // Locked: the assistant is Claude-only. Customers cannot change provider,
  // model, or key — it is admin-controlled and served from the store settings.
  const LOCKED_PROVIDER = 'anthropic';
  const DEFAULT_MODEL = 'claude-haiku-4-5';

  /* ---------------------------------------------------------------- state */
  let history = [];        // [{role:'user'|'model', text}]
  let busy = false;
  let screen = 'none';     // 'none' | 'setup' | 'chat'

  /* ------------------------------------------------------------------ DOM */
  const $ = (sel) => document.querySelector(sel);
  let els = {};

  function cacheDom() {
    els = {
      toggle: $('#chatToggle'),
      panel: $('#chatPanel'),
      close: $('#chatClose'),
      settings: $('#chatSettings'),
      subtitle: $('#chatTitle small'),
      messages: $('#chatMessages'),
      form: $('#chatForm'),
      input: $('#chatInput'),
      send: $('#chatSend'),
    };
  }

  /* i18n shortcuts (ItqanApp is ready before chat's DOMContentLoaded runs) */
  const L = (k) => window.ItqanApp.L(k);
  const fmt = (k, p) => window.ItqanApp.fmt(k, p);
  const fmtSAR = (n) => window.ItqanApp.fmtSAR(n);
  const getLang = () => window.ItqanApp.getLang();

  function esc(str) {
    return String(str)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }


  /* ======================================================================
   * CONFIG RESOLUTION — admin (shared) first, then per-user fallback
   * ==================================================================== */
  const adminAI = () => {
    const s = (window.ItqanApp && window.ItqanApp.getSettings && window.ItqanApp.getSettings())
      || globalThis.ITQAN_SETTINGS || {};
    return s.ai || {};
  };

  /**
   * Always Claude; customers never supply anything.
   * - proxy mode  → requests go to a server-side proxy (Cloudflare Worker) that
   *                 holds the key; the browser NEVER sees the key. Preferred.
   * - direct mode → legacy fallback: key travels from the browser (exposed).
   * @returns {{mode:'proxy'|'direct',url?,key?,model}|null}
   */
  function getAIConfig() {
    const a = adminAI();
    const proxyUrl = (a.proxyUrl || '').trim();
    if (proxyUrl) return { mode: 'proxy', url: proxyUrl, model: a.model || DEFAULT_MODEL };
    const key = (a.apiKey || '').trim();
    if (key) return { mode: 'direct', key, model: a.model || DEFAULT_MODEL };
    return null; // owner hasn't set up the assistant yet
  }

  /* ======================================================================
   * SYSTEM PROMPT — inventory injected on EVERY call
   * ==================================================================== */
  function compactInventory(db) {
    const pick = {
      cpu: (p) => ({ id: p.id, name: p.name, price: p.price, socket: p.socket, tdpWatts: p.tdpWatts, integratedGraphics: p.integratedGraphics }),
      motherboard: (p) => ({ id: p.id, name: p.name, price: p.price, socket: p.socket, ramType: p.ramType, formFactor: p.formFactor }),
      gpu: (p) => ({ id: p.id, name: p.name, price: p.price, powerDraw: p.powerDraw, recommendedPSU: p.recommendedPSU }),
      ram: (p) => ({ id: p.id, name: p.name, price: p.price, type: p.type, capacity: p.capacity, speed: p.speed }),
      storage: (p) => ({ id: p.id, name: p.name, price: p.price, type: p.type, capacity: p.capacity }),
      psu: (p) => ({ id: p.id, name: p.name, price: p.price, wattage: p.wattage, rating: p.rating }),
      case: (p) => ({ id: p.id, name: p.name, price: p.price, formFactorSupport: p.formFactorSupport }),
      cooler: (p) => ({ id: p.id, name: p.name, price: p.price, tdpSupport: p.tdpSupport }),
    };
    const out = {};
    for (const cat of Object.keys(db)) out[cat] = db[cat].map(pick[cat]);
    return out;
  }

  function buildSystemPrompt() {
    const db = window.ItqanApp.getDb();
    const inventory = JSON.stringify(compactInventory(db));
    const replyLang = getLang() === 'en' ? 'Reply in English.' : 'أجب باللغة العربية دائمًا.';
    return [
      'أنت «مساعد اتقان» — خبير تجميع أجهزة كمبيوتر في متجر اتقان السعودي. أسلوبك ودود ومحترف وموجز. ' + replyLang,
      '',
      'قواعد صارمة لا يجوز كسرها:',
      '1) رشِّح القطع حصريًا من مخزون المتجر المرفق أدناه، ولا تذكر أي منتج خارجه أبدًا.',
      '2) إذا لم تعرف بعد: الميزانية بالريال، الاستخدام (ألعاب/مونتاج/مكتبي)، والدقة المستهدفة (1080p/1440p/4K) — فاسأل عنها أولًا (سؤال واحد قصير في كل رسالة).',
      '3) تحقق من التوافق قبل أي ترشيح: سوكِت المعالج يطابق اللوحة، نوع الذاكرة يطابق اللوحة، وقدرة المزود ≥ (استهلاك المعالج + كرت الشاشة + 100 واط) × 1.2، والصندوق يدعم مقاس اللوحة، والمبرد يغطي حرارة المعالج.',
      '4) عند اقتراح تجميعة كاملة: اذكر لكل قطعة سطرًا واحدًا (الاسم — السعر — مبرر قصير)، ثم الإجمالي بالريال، ثم أنهِ رسالتك بكتلة JSON بهذا الشكل حرفيًا:',
      '```json',
      '{"build": {"cpu": "id", "motherboard": "id", "gpu": "id", "ram": "id", "storage": "id", "psu": "id", "case": "id", "cooler": "id"}}',
      '```',
      '5) استخدم قيم id الحقيقية من المخزون فقط داخل كتلة JSON.',
      '6) الأسعار كلها بالريال السعودي (SAR).',
      '',
      `مخزون المتجر الحالي (JSON): ${inventory}`,
    ].join('\n');
  }

  /* ======================================================================
   * NOT-CONFIGURED NOTICE — shown when the owner hasn't set the store key.
   * Customers never see a key field; they cannot supply their own.
   * ==================================================================== */
  function renderNotConfigured() {
    screen = 'none';
    els.messages.innerHTML = `
      <div class="chat-setup">
        <p class="chat-setup__title">${L('chat.offTitle')}</p>
        <p class="chat-setup__text">${L('chat.offText')}</p>
      </div>`;
    setFormEnabled(false);
  }

  /* ======================================================================
   * MESSAGE RENDERING
   * ==================================================================== */
  function setFormEnabled(on) { els.input.disabled = !on; els.send.disabled = !on; }
  function scrollToBottom() { els.messages.scrollTop = els.messages.scrollHeight; }

  function appendBubble(role, html) {
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg--${role}`;
    div.innerHTML = html;
    els.messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function formatModelText(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^[-•]\s?(.+)$/gm, '<span class="chat-bullet">$1</span>')
      .replace(/\n/g, '<br>');
  }

  function renderWelcome() {
    screen = 'chat';
    els.messages.innerHTML = '';
    appendBubble('model', `${L('chat.welcome1')}<br>${L('chat.welcome2')}`);
    const chips = document.createElement('div');
    chips.className = 'chat-chips';
    [L('chat.chip1'), L('chat.chip2')].forEach((q) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-chip';
      b.textContent = q;
      b.addEventListener('click', () => sendMessage(q));
      chips.appendChild(b);
    });
    els.messages.appendChild(chips);
    setFormEnabled(true);
    els.input.focus();
  }

  /* ======================================================================
   * BUILD PARSING & APPLY CARD
   * ==================================================================== */
  function extractBuild(text) {
    const match = text.match(/```json\s*([\s\S]*?)```/);
    if (!match) return { cleanText: text, build: null };
    let build = null;
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed.build === 'object' && parsed.build !== null) build = parsed.build;
    } catch { /* malformed JSON — just show text */ }
    return { cleanText: text.replace(match[0], '').trim(), build };
  }

  function renderBuildCard(build) {
    const db = window.ItqanApp.getDb();
    const resolved = {};
    let total = 0;
    for (const cat of CATEGORY_ORDER) {
      const id = build[cat];
      if (!id) continue;
      const part = (db[cat] || []).find((p) => p.id === id);
      if (part) { resolved[cat] = part; total += part.price; }
    }
    const count = Object.keys(resolved).length;
    if (count === 0) return;

    const summary = Compat.buildSummary(resolved, CATEGORY_ORDER);
    const ok = summary.status === 'ok';
    const card = document.createElement('div');
    card.className = 'chat-build-card';
    card.innerHTML = `
      <p class="chat-build-card__title">${esc(fmt('chat.buildTitle', { a: count, b: fmtSAR(total) }))}</p>
      <p class="chat-build-card__status" data-status="${ok ? 'ok' : 'warn'}">
        ${ok ? esc(L('chat.buildOk')) : esc(fmt('chat.buildWarn', { a: fmt(summary.msgCode, summary.msgParams) }))}
      </p>
      <button type="button" class="btn btn--primary chat-build-card__apply">${esc(L('chat.apply'))}</button>`;
    card.querySelector('.chat-build-card__apply').addEventListener('click', () => {
      window.ItqanApp.applyBuild(build);
      closeChat();
    });
    els.messages.appendChild(card);
    scrollToBottom();
  }

  /* ======================================================================
   * API CALL (provider-dispatched)
   * ==================================================================== */
  function friendlyError(status) {
    if (status === 400 || status === 401 || status === 403) return L('chat.errUnavailable');
    if (status === 429) return L('chat.errQuota');
    if (status === 0) return L('chat.errNet');
    return L('chat.errGeneric');
  }

  /** Build the Claude request for the active mode (proxy hides the key). */
  function buildRequest(cfg) {
    const messages = history.slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }));
    const body = { model: cfg.model || DEFAULT_MODEL, max_tokens: 1024, system: buildSystemPrompt(), messages };
    if (cfg.mode === 'proxy') {
      // No key in the browser — the Worker attaches it server-side.
      return { url: cfg.url, headers: { 'Content-Type': 'application/json' }, body };
    }
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
    };
  }

  /** Both proxy and direct return Anthropic's native response shape. */
  const parseReply = (d) => (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

  async function callAI() {
    const cfg = getAIConfig();
    if (!cfg) throw new Error(L('chat.errUnavailable'));
    const { url, headers, body } = buildRequest(cfg);

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      throw new Error(friendlyError(0)); // network / CORS failure
    }
    if (!res.ok) throw new Error(friendlyError(res.status));

    const data = await res.json();
    const text = parseReply(data);
    if (!text) throw new Error(L('chat.errEmpty'));
    return text;
  }

  /* ======================================================================
   * SEND FLOW
   * ==================================================================== */
  async function sendMessage(text) {
    if (busy || !text.trim()) return;
    busy = true;
    setFormEnabled(false);

    const chips = els.messages.querySelector('.chat-chips');
    if (chips) chips.remove();

    history.push({ role: 'user', text: text.trim() });
    appendBubble('user', esc(text.trim()));
    els.input.value = '';

    const typing = appendBubble('model',
      `<span class="chat-typing" aria-label="${esc(L('chat.typing'))}"><i></i><i></i><i></i></span>`);

    try {
      const reply = await callAI();
      history.push({ role: 'model', text: reply });
      const { cleanText, build } = extractBuild(reply);
      typing.innerHTML = formatModelText(cleanText || L('chat.fallback'));
      if (build) renderBuildCard(build);
    } catch (err) {
      typing.classList.add('chat-msg--error');
      typing.innerHTML = esc(err.message);
    } finally {
      busy = false;
      setFormEnabled(true);
      els.input.focus();
      scrollToBottom();
    }
  }

  /* ======================================================================
   * OPEN / CLOSE
   * ==================================================================== */
  function syncSubtitle(cfg) {
    if (!els.subtitle) return;
    if (cfg) {
      els.subtitle.textContent = getLang() === 'en'
        ? 'Powered by Claude — recommends from store stock only'
        : 'مدعوم بـ Claude — يرشّح من مخزون المتجر فقط';
    } else {
      els.subtitle.textContent = L('chat.subtitle');
    }
  }

  function openChat() {
    els.panel.classList.add('is-open');
    els.toggle.setAttribute('aria-expanded', 'true');

    const cfg = getAIConfig();
    syncSubtitle(cfg);
    if (els.settings) els.settings.style.display = 'none'; // customers can't change anything

    if (!cfg) {
      renderNotConfigured();
    } else if (history.length === 0 && screen !== 'chat') {
      renderWelcome();
    } else {
      els.input.focus();
    }
  }

  function closeChat() {
    els.panel.classList.remove('is-open');
    els.toggle.setAttribute('aria-expanded', 'false');
    els.toggle.focus();
  }

  /* ======================================================================
   * BOOT
   * ==================================================================== */
  document.addEventListener('DOMContentLoaded', () => {
    cacheDom();

    els.toggle.addEventListener('click', () => {
      els.panel.classList.contains('is-open') ? closeChat() : openChat();
    });
    els.close.addEventListener('click', closeChat);
    if (els.settings) els.settings.style.display = 'none'; // no customer-facing AI settings

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage(els.input.value);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.panel.classList.contains('is-open')) closeChat();
    });

    document.addEventListener('itqan:lang', () => {
      if (!els.panel.classList.contains('is-open')) return;
      const cfg = getAIConfig();
      syncSubtitle(cfg);
      if (!cfg) renderNotConfigured();
      else if (screen === 'chat' && history.length === 0) renderWelcome();
    });
  });
})();
