// Supabase Edge Function — busca filmes/séries reais via TMDB (The Movie Database),
// em vez de notícias por palavra-chave (que retornava qualquer matéria que mencionasse
// os termos, não uma listagem real de cinema).
// Deploy: cole essa função numa function chamada "media" no painel do Supabase.
// Secret: TMDB_API_KEY (gratuito, crie em https://www.themoviedb.org/settings/api)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function tmdbGet(path: string, apiKey: string) {
  const url = `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${apiKey}&language=pt-BR`;
  return fetch(url).then(r => r.json());
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('TMDB_API_KEY');
  const url = new URL(req.url);
  const type = (url.searchParams.get('type') || '').trim();

  if (!apiKey || !type) {
    return Response.json({ items: [], error: 'Faltando tipo (filmes/series) ou chave TMDB no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    const seen = new Set<string>();
    const items: { title: string; overview: string }[] = [];

    if (type === 'filmes') {
      const nowPlaying = await tmdbGet('/movie/now_playing?region=BR', apiKey);
      const trending = await tmdbGet('/trending/movie/week', apiKey);
      for (const m of [...(nowPlaying.results || []), ...(trending.results || [])]) {
        if (seen.has(m.title)) continue;
        seen.add(m.title);
        const year = (m.release_date || '').slice(0, 4);
        const title = year ? `${m.title} (${year})` : m.title;
        items.push({ title, overview: m.overview || '' });
      }
    } else if (type === 'series') {
      const onTheAir = await tmdbGet('/tv/on_the_air', apiKey);
      const trending = await tmdbGet('/trending/tv/week', apiKey);
      for (const s of [...(onTheAir.results || []), ...(trending.results || [])]) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        const year = (s.first_air_date || '').slice(0, 4);
        const title = year ? `${s.name} (${year})` : s.name;
        items.push({ title, overview: s.overview || '' });
      }
    } else {
      return Response.json({ items: [], error: 'Tipo inválido, use filmes ou series.' }, { headers: CORS_HEADERS });
    }

    return Response.json({ items, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ items: [], error: 'Erro ao consultar TMDB: ' + e.message }, { headers: CORS_HEADERS });
  }
});
