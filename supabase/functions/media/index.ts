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

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
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
    const items: { title: string; overview: string; link: string; poster: string | null }[] = [];
    const posterUrl = (path: string | null) => path ? `https://image.tmdb.org/t/p/w500${path}` : null;

    if (type === 'filmes') {
      let nowPlaying = await tmdbGet('/movie/now_playing?region=BR', apiKey);
      if (!nowPlaying.results || nowPlaying.results.length === 0) {
        nowPlaying = await tmdbGet('/movie/now_playing', apiKey); // fallback sem filtro de região
      }
      let upcoming = await tmdbGet('/movie/upcoming?region=BR', apiKey);
      if (!upcoming.results || upcoming.results.length === 0) {
        upcoming = await tmdbGet('/movie/upcoming', apiKey);
      }

      for (const m of (nowPlaying.results || [])) {
        if (seen.has(m.title)) continue;
        seen.add(m.title);
        items.push({ title: `${m.title} está em cartaz`, overview: m.overview || '', link: `https://www.themoviedb.org/movie/${m.id}`, poster: posterUrl(m.poster_path) });
      }
      for (const m of (upcoming.results || [])) {
        if (seen.has(m.title)) continue;
        seen.add(m.title);
        const data = formatDate(m.release_date);
        items.push({ title: `${m.title} chega aos cinemas${data ? ' em ' + data : ' em breve'}`, overview: m.overview || '', link: `https://www.themoviedb.org/movie/${m.id}`, poster: posterUrl(m.poster_path) });
      }
    } else if (type === 'series') {
      const onTheAir = await tmdbGet('/tv/on_the_air', apiKey);
      const trending = await tmdbGet('/trending/tv/week', apiKey);
      for (const s of (onTheAir.results || [])) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        items.push({ title: `${s.name} está no ar`, overview: s.overview || '', link: `https://www.themoviedb.org/tv/${s.id}`, poster: posterUrl(s.poster_path) });
      }
      for (const s of (trending.results || [])) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        items.push({ title: `${s.name} está em alta`, overview: s.overview || '', link: `https://www.themoviedb.org/tv/${s.id}`, poster: posterUrl(s.poster_path) });
      }
    } else {
      return Response.json({ items: [], error: 'Tipo inválido, use filmes ou series.' }, { headers: CORS_HEADERS });
    }

    return Response.json({ items, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ items: [], error: 'Erro ao consultar TMDB: ' + e.message }, { headers: CORS_HEADERS });
  }
});
