// Supabase Edge Function — busca um RSS/Atom no servidor (sem depender de proxy CORS
// de terceiro) e devolve título + resumo de cada item. Suporta tanto <item> (RSS)
// quanto <entry> (Atom).
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

function extractTag(block: string, tag: string) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  let t = m[1].trim();
  t = t.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  return decodeEntities(t).trim();
}

function stripHtmlTags(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
    const items = blocks
      .map(block => {
        const title = extractTag(block, 'title');
        const rawDescription = extractTag(block, 'description') || extractTag(block, 'summary');
        const description = stripHtmlTags(rawDescription);
        return { title, description };
      })
      .filter(item => item.title);
    return Response.json({ items, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ items: [], error: 'Falha ao buscar o feed: ' + e.message }, { headers: CORS_HEADERS });
  }
});
