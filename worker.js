/**
 * =============================================================================
 * ITQAN STORE — CLAUDE PROXY (Cloudflare Worker)
 * =============================================================================
 * A tiny server-side proxy that keeps the Anthropic (Claude) API key SECRET.
 * The store front-end (chat.js, proxy mode) POSTs a chat request here; this
 * Worker attaches the key and forwards it to Anthropic, then returns the reply.
 * The key lives ONLY as a Cloudflare secret (env.ANTHROPIC_KEY) — it never
 * reaches the browser, the repo, or GitHub.
 *
 * ── Deploy (see WORKER-SETUP.md) ─────────────────────────────────────────────
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker → paste this file
 *   2. Settings → Variables and Secrets → add secret  ANTHROPIC_KEY = sk-ant-...
 *   3. Deploy → copy the *.workers.dev URL → give it to Claude to wire up
 *
 * Abuse guards: only the store origin may call it, model is forced to Claude,
 * and max_tokens is capped. Tighten ALLOWED_ORIGINS to your final domain.
 * =============================================================================
 */

const ALLOWED_ORIGINS = [
  'https://voltstore.github.io',   // GitHub Pages (public store + admin)
  'http://localhost',              // local double-click / dev
  'http://127.0.0.1',
  'null',                          // file:// (opening index.html directly)
];

const MAX_TOKENS_CAP = 1500;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o))
    ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, origin);
    }
    // Defense-in-depth: reject browsers from other sites (not foolproof, but
    // blocks casual reuse of your Worker URL from another web page).
    if (origin && !ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o))) {
      return json({ error: 'forbidden_origin' }, 403, origin);
    }
    if (!env.ANTHROPIC_KEY) {
      return json({ error: 'server_not_configured' }, 500, origin);
    }

    let payload;
    try { payload = await request.json(); }
    catch { return json({ error: 'bad_json' }, 400, origin); }

    const model = String(payload.model || 'claude-haiku-4-5');
    if (!model.startsWith('claude-')) {
      return json({ error: 'model_not_allowed' }, 400, origin);
    }

    const body = {
      model,
      max_tokens: Math.min(Number(payload.max_tokens) || 1024, MAX_TOKENS_CAP),
      system: typeof payload.system === 'string' ? payload.system : '',
      messages: Array.isArray(payload.messages) ? payload.messages : [],
    };

    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return json({ error: 'upstream_unreachable', detail: String(e) }, 502, origin);
    }

    // Pass Anthropic's response (and status) straight back, with CORS added.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    });
  },
};
