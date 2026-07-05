/**
 * =============================================================================
 * ITQAN STORE — AI BUILD ASSISTANT (chat.js)
 * =============================================================================
 * Floating, bilingual chat widget. The AI provider, model, and API key are
 * configured ONCE by the store owner in admin.html (→ settings.js), so the
 * assistant works for every visitor without them entering anything.
 *
 * Supported providers (direct REST fetch, no SDK, no backend):
 *   - gemini    → Google Gemini            (models: gemini-2.0-flash, 2.5-flash)
 *   - openai    → OpenAI / ChatGPT         (gpt-4o-mini, gpt-4o, gpt-4.1-mini)
 *   - anthropic → Anthropic / Claude       (claude-haiku-4-5, sonnet-5, opus-4-8)
 *
 * ⚠️ SECURITY: a key placed in settings.js is served to every visitor and is
 *    therefore public. Use a spend-limited key. The safe long-term fix is a
 *    tiny server-side proxy (Phase 2 / Firebase Functions) that holds the key.
 *
 * Fallback: if the owner hasn't configured a key, a visitor can paste their own
 * (stored only in their localStorage) — the original per-user flow.
 * =============================================================================
 */
(function () {
  'use strict';

  const KEY_STORAGE = 'itqan-ai-key';   // per-user fallback key (localStorage)
  const MAX_HISTORY = 12;

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
   * PROVIDER ABSTRACTION — each maps (systemPrompt, history, cfg) to a
   * request, and a raw response back to text. Roles: our history uses
   * 'user'/'model'; OpenAI + Anthropic want 'assistant' instead of 'model'.
   * ==================================================================== */
  const roleFor = (m, modelRole) => (m.role === 'model' ? modelRole : 'user');

  const PROVIDERS = {
    gemini: {
      label: 'Google Gemini',
      build(sys, hist, cfg) {
        const model = cfg.model || 'gemini-2.0-flash';
        return {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.key)}`,
          headers: { 'Content-Type': 'application/json' },
          body: {
            systemInstruction: { parts: [{ text: sys }] },
            contents: hist.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
            generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
          },
        };
      },
      parse: (d) => (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim(),
    },

    openai: {
      label: 'OpenAI · ChatGPT',
      build(sys, hist, cfg) {
        return {
          url: 'https://api.openai.com/v1/chat/completions',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
          body: {
            model: cfg.model || 'gpt-4o-mini',
            max_tokens: 1024,
            temperature: 0.4,
            messages: [
              { role: 'system', content: sys },
              ...hist.map((m) => ({ role: roleFor(m, 'assistant'), content: m.text })),
            ],
          },
        };
      },
      parse: (d) => (d.choices?.[0]?.message?.content || '').trim(),
    },

    anthropic: {
      label: 'Anthropic · Claude',
      build(sys, hist, cfg) {
        // NOTE: no `temperature` — it's rejected (400) on Opus 4.8 / Sonnet 5.
        return {
          url: 'https://api.anthropic.com/v1/messages',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': cfg.key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: {
            model: cfg.model || 'claude-haiku-4-5',
            max_tokens: 1024,
            system: sys,
            messages: hist.map((m) => ({ role: roleFor(m, 'assistant'), content: m.text })),
          },
        };
      },
      parse: (d) => (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim(),
    },
  };

  /* ======================================================================
   * CONFIG RESOLUTION — admin (shared) first, then per-user fallback
   * ==================================================================== */
  const adminAI = () => {
    const s = (window.ItqanApp && window.ItqanApp.getSettings && window.ItqanApp.getSettings())
      || globalThis.ITQAN_SETTINGS || {};
    return s.ai || {};
  };

  /** @returns {{provider,model,key,source}|null} */
  function getAIConfig() {
    const a = adminAI();
    if (a.apiKey && a.apiKey.trim()) {
      return { provider: a.provider || 'gemini', model: a.model, key: a.apiKey.trim(), source: 'admin' };
    }
    const uk = (localStorage.getItem(KEY_STORAGE) || '').trim();
    if (uk) {
      return { provider: a.provider || 'gemini', model: a.model || 'gemini-2.0-flash', key: uk, source: 'user' };
    }
    return null; // nothing configured anywhere
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
   * PER-USER KEY SETUP (fallback only — when the owner set no key)
   * ==================================================================== */
  function renderKeySetup(isChange) {
    screen = 'setup';
    const provider = adminAI().provider || 'gemini';
    const label = (PROVIDERS[provider] || PROVIDERS.gemini).label;
    els.messages.innerHTML = `
      <div class="chat-setup">
        <p class="chat-setup__title">${isChange ? L('chat.setupChangeTitle') : L('chat.setupTitle')}</p>
        <p class="chat-setup__text">${L('chat.setupText')} <b dir="ltr">${esc(label)}</b>.</p>
        <form class="chat-setup__form" id="chatKeyForm">
          <label class="sr-only" for="chatKeyInput">${L('chat.keyLabel')}</label>
          <input id="chatKeyInput" type="password" dir="ltr" autocomplete="off" placeholder="..." required>
          <button type="submit" class="btn btn--primary btn--small">${L('chat.saveKey')}</button>
        </form>
      </div>`;
    $('#chatKeyForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = $('#chatKeyInput').value.trim();
      if (!val) return;
      localStorage.setItem(KEY_STORAGE, val);
      history = [];
      renderWelcome();
    });
    $('#chatKeyInput').focus();
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
    if (status === 400 || status === 401 || status === 403) return L('chat.errKey');
    if (status === 429) return L('chat.errQuota');
    if (status === 0) return L('chat.errNet');
    return L('chat.errGeneric');
  }

  async function callAI() {
    const cfg = getAIConfig();
    if (!cfg) throw new Error(L('chat.errKey'));
    const provider = PROVIDERS[cfg.provider] || PROVIDERS.gemini;
    const { url, headers, body } = provider.build(buildSystemPrompt(), history.slice(-MAX_HISTORY), cfg);

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      throw new Error(friendlyError(0)); // network / CORS failure
    }
    if (!res.ok) throw new Error(friendlyError(res.status));

    const data = await res.json();
    const text = provider.parse(data);
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
      const label = (PROVIDERS[cfg.provider] || PROVIDERS.gemini).label;
      els.subtitle.textContent = getLang() === 'en'
        ? `Powered by ${label} — recommends from store stock only`
        : `مدعوم بـ ${label} — يرشّح من مخزون المتجر فقط`;
    } else {
      els.subtitle.textContent = L('chat.subtitle');
    }
  }

  function openChat() {
    els.panel.classList.add('is-open');
    els.toggle.setAttribute('aria-expanded', 'true');

    const cfg = getAIConfig();
    syncSubtitle(cfg);
    // The per-user "change key" control only matters for the fallback flow.
    els.settings.style.display = (cfg && cfg.source === 'admin') ? 'none' : '';

    if (!cfg) {
      renderKeySetup(false);           // fallback: visitor supplies their own key
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
    els.settings.addEventListener('click', () => renderKeySetup(true));

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage(els.input.value);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.panel.classList.contains('is-open')) closeChat();
    });

    document.addEventListener('itqan:lang', () => {
      if (els.panel.classList.contains('is-open')) syncSubtitle(getAIConfig());
      if (screen === 'setup') renderKeySetup(false);
      else if (screen === 'chat' && history.length === 0) renderWelcome();
    });
  });
})();
