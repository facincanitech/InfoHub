// Supabase Edge Function — busca um RSS/Atom no servidor (sem depender de proxy CORS
// de terceiro) e devolve só os títulos. Suporta tanto <item> (RSS) quanto <entry> (Atom,
// usado pelo feed do Reddit).
// Deploy: cole esse código numa function chamada "rss" no painel do Supabase.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTitle(block: string) {
  const m = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  let t = m[1].trim();
  t = t.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  return decodeEntities(t).trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return Response.json({ items: [], error: 'Faltando parâmetro url.' }, { headers: CORS_HEADERS });
  }

  try {
    const res = await fetch(target, { headers: { 'User-Agent': 'InfoHub/1.0 (briefing app; +https://github.com/facincanitech/InfoHub)' } });
    if (!res.ok) {
      return Response.json({ items: [], error: `Feed retornou ${res.status}.` }, { headers: CORS_HEADERS });
    }
    const text = await res.text();
    let blocks = text.match(/<item[\s\S]*?<\/item>/gi);
    if (!blocks || blocks.length === 0) blocks = text.match(/<entry[\s\S]*?<\/entry>/gi) || [];
    const items = blocks.map(extractTitle).filter(Boolean);
    return Response.json({ items, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ items: [], error: 'Falha ao buscar o feed: ' + e.message }, { headers: CORS_HEADERS });
  }
});
