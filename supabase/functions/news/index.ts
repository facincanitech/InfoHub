// Supabase Edge Function — busca notícias com resumo de verdade via GNews
// (o RSS do Google News só traz o título, o <description> dele é só um link
// decorado, sem texto de resumo).
// Deploy: cole essa função numa function chamada "news" no painel do Supabase.
// Secret: GNEWS_API_KEY (gratuito, crie em https://gnews.io)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('GNEWS_API_KEY');
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();

  if (!apiKey || !q) {
    return Response.json({ items: [], error: 'Faltando palavra-chave ou chave GNews no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    const gnewsUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=pt&country=br&max=5&apikey=${apiKey}`;
    const resp = await fetch(gnewsUrl).then(r => r.json());
    if (!resp.articles) {
      return Response.json({ items: [], error: `GNews: ${resp.errors ? resp.errors.join(', ') : 'sem resultados'}` }, { headers: CORS_HEADERS });
    }
    const items = resp.articles.map((a: any) => ({
      title: a.title,
      description: a.description || '',
      link: a.url,
      source: (a.source && a.source.name) || '',
      image: a.image || null,
    }));
    return Response.json({ items, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ items: [], error: 'Erro ao consultar GNews: ' + e.message }, { headers: CORS_HEADERS });
  }
});
