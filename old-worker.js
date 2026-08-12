const PUMPERLY = 'https://pumperly.com';
const ALLOWED_ORIGINS = new Set([
  'https://rabojan.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://rabojan.github.io';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'manni-fuel-api' }, { headers: cors });
    }

    if (url.pathname !== '/api/stations' && url.pathname !== '/api/exchange-rates') {
      return new Response('Not found', { status: 404, headers: cors });
    }

    // Prevent this Worker from becoming a general open proxy.
    const upstream = new URL(PUMPERLY + url.pathname);
    for (const [k, v] of url.searchParams) upstream.searchParams.set(k, v);

    // Cache identical queries briefly at Cloudflare edge locations.
    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    let upstreamResponse = await cache.match(cacheKey);

    if (!upstreamResponse) {
      upstreamResponse = await fetch(upstream.toString(), {
        headers: { 'Accept': 'application/json', 'User-Agent': 'ManniFuel/1.0' }
      });
      if (!upstreamResponse.ok) {
        return Response.json(
          { error: 'Upstream error', status: upstreamResponse.status },
          { status: 502, headers: cors }
        );
      }
      const h = new Headers(upstreamResponse.headers);
      h.set('Cache-Control', url.pathname === '/api/stations' ? 'public, max-age=60' : 'public, max-age=3600');
      h.set('Content-Type', 'application/json; charset=utf-8');
      upstreamResponse = new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: h });
      ctx.waitUntil(cache.put(cacheKey, upstreamResponse.clone()));
    }

    const headers = new Headers(upstreamResponse.headers);
    Object.entries(cors).forEach(([k,v]) => headers.set(k,v));
    headers.set('X-Manni-Proxy', 'cloudflare-worker');
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers });
  }
};
