// Supabase Edge Function — busca fotos reais de céu (sol/nublado/chuva/noite) via
// Wikimedia Commons, pro herói animado da categoria Clima no Guia. Sem chave
// nenhuma (mesma família de API que a Wikipédia, já usada no assistente de voz).
// Deploy: cole essa função numa function chamada "weather-images" no painel do Supabase.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SCENES: Record<string, string> = {
  sol: 'sunny blue sky',
  nublado: 'cloudy sky',
  chuva: 'rain storm sky',
  noite: 'starry night sky',
};

async function searchCommonsImage(query: string): Promise<string | null> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent('filetype:bitmap ' + query)}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*`;
  try {
    const data = await fetch(url).then((r) => r.json());
    const pages = data.query && data.query.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0] as any;
    const info = page && page.imageinfo && page.imageinfo[0];
    return (info && (info.thumburl || info.url)) || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const entries = Object.entries(SCENES);
    const results = await Promise.all(entries.map(([, query]) => searchCommonsImage(query)));
    const images: Record<string, string | null> = {};
    entries.forEach(([key], i) => { images[key] = results[i]; });
    return Response.json({ images, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ images: {}, error: 'Erro ao buscar imagens: ' + e.message }, { headers: CORS_HEADERS });
  }
});
