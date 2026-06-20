// Supabase Edge Function — busca o vídeo mais recente de um canal do YouTube pelo
// nome. Resolve nome -> ID do canal só na primeira vez (busca, cara em cota da
// API); se o client já mandar o channelId em cache, pula direto pra busca barata
// do vídeo mais recente (channels.list + playlistItems.list).
// Deploy: cole essa função numa function chamada "youtube-channel" no painel do Supabase.
// Secret: YOUTUBE_API_KEY (gratuito — ative "YouTube Data API v3" no Google Cloud
// Console e crie uma API key, não precisa de OAuth nem login do usuário)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('YOUTUBE_API_KEY');
  const url = new URL(req.url);
  const name = (url.searchParams.get('name') || '').trim();
  let channelId = (url.searchParams.get('channelId') || '').trim();

  if (!apiKey || !name) {
    return Response.json({ error: 'Faltando nome do canal ou chave do YouTube no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    let channelTitle = '';

    if (!channelId) {
      // Resolve nome -> ID (search.list custa 100 unidades — só roda na 1ª vez por canal).
      const searchResp = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(name)}&type=channel&maxResults=1&key=${apiKey}`).then(r => r.json());
      const found = searchResp.items && searchResp.items[0];
      if (!found) {
        return Response.json({ error: `Canal "${name}" não encontrado.` }, { headers: CORS_HEADERS });
      }
      channelId = found.snippet.channelId;
      channelTitle = found.snippet.channelTitle || found.snippet.title;
    }

    // channels.list + playlistItems.list custam ~1 unidade cada — baratos, rodam todo play.
    const channelResp = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&id=${channelId}&key=${apiKey}`).then(r => r.json());
    const channel = channelResp.items && channelResp.items[0];
    if (!channel) {
      return Response.json({ error: `Canal "${name}" não encontrado (ID inválido).` }, { headers: CORS_HEADERS });
    }
    if (!channelTitle) channelTitle = channel.snippet.title;
    const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

    const itemsResp = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=1&key=${apiKey}`).then(r => r.json());
    const latest = itemsResp.items && itemsResp.items[0];
    if (!latest) {
      return Response.json({ channelId, channelTitle, video: null, error: null }, { headers: CORS_HEADERS });
    }

    const video = {
      title: latest.snippet.title,
      description: latest.snippet.description || '',
      videoId: latest.snippet.resourceId.videoId,
    };

    return Response.json({ channelId, channelTitle, video, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ error: 'Erro ao consultar YouTube: ' + e.message }, { headers: CORS_HEADERS });
  }
});
