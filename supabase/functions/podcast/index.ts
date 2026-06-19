// Supabase Edge Function — resolve um nome de podcast pro feed RSS dele via iTunes
// Search API (sem chave) e devolve os títulos dos episódios mais recentes.
// Deploy: cole esse código numa function chamada "podcast" no painel do Supabase.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function decodeEntities(text: string) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function extractTitle(block: string) {
  const m = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  let t = m[1].trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  return decodeEntities(t).trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const name = (url.searchParams.get('name') || '').trim();
  if (!name) {
    return Response.json({ items: [], error: 'Faltando nome do podcast.' }, { headers: CORS_HEADERS });
  }

  try {
    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&media=podcast&limit=1`;
    const search = await fetch(searchUrl).then(r => r.json());
    const feedUrl = search.results && search.results[0] && search.results[0].feedUrl;
    if (!feedUrl) {
      return Response.json({ items: [], error: `Podcast "${name}" não encontrado.` }, { headers: CORS_HEADERS });
    }

    const feedRes = await fetch(feedUrl, { headers: { 'User-Agent': 'InfoHub/1.0 (briefing app)' } });
    const text = await feedRes.text();
    const blocks = text.match(/<item[\s\S]*?<\/item>/gi) || [];
    const items = blocks.map(extractTitle).filter(Boolean);
    return Response.json({ items, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ items: [], error: 'Erro ao buscar podcast: ' + e.message }, { headers: CORS_HEADERS });
  }
});
