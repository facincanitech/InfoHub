// Supabase Edge Function — busca de música/vídeo no YouTube pro MultiSonor.
// Três modos:
//  - sem channelId/playlistId: busca mista (artistas + vídeos) pelo termo,
//    pra mostrar a grade de artistas + lista de músicas/vídeos.
//  - com channelId: lista os vídeos do canal (clicou num artista) + as
//    playlists públicas dele (a aproximação mais próxima de "álbuns" que a
//    API pública do YouTube expõe).
//  - com playlistId: lista os vídeos daquela playlist/álbum específico.
// Deploy: cole essa função numa function chamada "youtube-music" no painel do Supabase.
// Secrets: YOUTUBE_API_KEY (mesma chave já usada em "Canais do YouTube"),
//          SUPABASE_SERVICE_ROLE_KEY (pro cache — ver tabela youtube_cache em schema.sql)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = 'https://xpscjwcqgdldwtmbbzua.supabase.co';

// TTLs diferentes por tipo: busca por nome (artista/álbum/playlist) e
// playlist/vídeo isolado quase não mudam de conteúdo (uma playlist de
// "anos 90" não ganha vídeo novo do nada) — guarda bem mais tempo. Canal
// é o único que precisa ficar curto, já que a ideia ali é mostrar o
// upload mais recente do artista.
const CACHE_TTL_SEARCH_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias — busca por nome
const CACHE_TTL_CHANNEL_MS = 12 * 60 * 60 * 1000; // 12h — vídeos recentes do canal
const CACHE_TTL_PLAYLIST_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias — conteúdo de playlist/álbum raramente muda
const CACHE_TTL_VIDEO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — metadado de 1 vídeo específico é praticamente fixo

// Cache simples na tabela youtube_cache (ver schema.sql) — uma busca por
// "michael jackson" feita por uma pessoa hoje responde de graça pra
// qualquer outra pessoa que buscar o mesmo dentro do prazo. Falha
// silenciosa de propósito (sem SUPABASE_SERVICE_ROLE_KEY ou erro de rede,
// só ignora o cache e segue pra API normal) — cache é otimização, não pode
// quebrar a busca se o banco estiver fora.
async function getCached(key: string, ttlMs: number): Promise<any | null> {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return null;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/youtube_cache?cache_key=eq.${encodeURIComponent(key)}&select=response,created_at`,
      { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
    );
    const rows = await resp.json();
    const row = Array.isArray(rows) && rows[0];
    if (!row) return null;
    const age = Date.now() - new Date(row.created_at).getTime();
    return age < ttlMs ? row.response : null;
  } catch (_e) {
    return null;
  }
}

async function setCached(key: string, response: any): Promise<void> {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/youtube_cache`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ cache_key: key, response, created_at: new Date().toISOString() }),
    });
  } catch (_e) {
    // cache é só otimização — se falhar escrever, a busca já respondeu mesmo assim
  }
}

function mapVideoItem(it: any) {
  return {
    videoId: it.id.videoId,
    title: it.snippet.title,
    channelTitle: it.snippet.channelTitle,
    thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
  };
}

// Item de playlistItems.list tem formato diferente do de search.list — o id
// do vídeo vem em snippet.resourceId.videoId, não em id.videoId. Guarda
// publishedAt só pra poder ordenar depois (playlistItems.list não tem
// parâmetro de "order" como o search.list tem) — não vai pro resultado final.
function mapPlaylistVideoItem(it: any) {
  return {
    videoId: it.snippet.resourceId?.videoId,
    title: it.snippet.title,
    channelTitle: it.snippet.videoOwnerChannelTitle || it.snippet.channelTitle,
    thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
    _publishedAt: it.snippet.publishedAt,
  };
}

function mapChannelItem(it: any) {
  return {
    channelId: it.id.channelId || it.snippet.channelId,
    title: it.snippet.channelTitle || it.snippet.title,
    thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
  };
}

function mapPlaylistItem(it: any) {
  return {
    playlistId: it.id,
    title: it.snippet.title,
    thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
  };
}

// Item de search.list com type=playlist tem o playlistId dentro de
// id.playlistId — diferente do playlists.list (mapPlaylistItem acima), onde
// it.id já É o playlistId direto.
function mapPlaylistSearchItem(it: any) {
  return {
    playlistId: it.id.playlistId,
    title: it.snippet.title,
    thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
  };
}

// O YouTube devolve erro (ex: cota diária excedida) num corpo JSON com
// "error", sem nenhum "items" — antes a gente só fazia `resp.items || []` e
// isso virava silenciosamente "nada encontrado", escondendo o motivo real
// (já aconteceu: parecia bug de busca, era cota da API estourada).
function apiErrorMessage(resp: any): string | null {
  return resp?.error?.message || null;
}

// Mensagem técnica do Google ("Quota exceeded for quota metric...") não diz
// nada útil pro usuário final — troca por algo que ele entenda, mas mantém o
// texto original no log do servidor (console.error) pra continuar dando pra
// diagnosticar de verdade quando precisar.
function friendlyErrorMessage(apiError: string): string {
  console.error('Erro da API do YouTube:', apiError);
  if (/quota/i.test(apiError)) {
    return 'Muita gente buscando música agora — tenta de novo em alguns minutos.';
  }
  return 'Não foi possível buscar agora. Tenta de novo em alguns minutos.';
}

async function buscarArtistas(apiKey: string, termo: string) {
  const params = new URLSearchParams({
    part: 'snippet', q: termo, type: 'channel', order: 'relevance', maxResults: '15', key: apiKey,
  });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`).then((r) => r.json());
  return { items: (resp.items || []).map(mapChannelItem), apiError: apiErrorMessage(resp) };
}

// order:'date' aqui é só pra desempatar a relevância dos resultados da BUSCA
// em si (o termo digitado), não tem relação com o quão recente é o canal —
// quem quiser os uploads mais novos de um artista específico usa o card dele
// (buscarConteudoDoCanal), que aí sim é ordenado por data de upload real.
async function buscarVideos(apiKey: string, termo: string) {
  const params = new URLSearchParams({
    part: 'snippet', q: termo, type: 'video', order: 'date', maxResults: '50', key: apiKey,
  });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`).then((r) => r.json());
  return { items: (resp.items || []).map(mapVideoItem), apiError: apiErrorMessage(resp) };
}

async function buscarPlaylistsPorNome(apiKey: string, termo: string) {
  const params = new URLSearchParams({
    part: 'snippet', q: termo, type: 'playlist', order: 'relevance', maxResults: '25', key: apiKey,
  });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`).then((r) => r.json());
  return { items: (resp.items || []).map(mapPlaylistSearchItem), apiError: apiErrorMessage(resp) };
}

async function buscarMisto(apiKey: string, termo: string) {
  const [a, v, p] = await Promise.all([
    buscarArtistas(apiKey, termo),
    buscarVideos(apiKey, termo),
    buscarPlaylistsPorNome(apiKey, termo),
  ]);
  return { artists: a.items, videos: v.items, playlists: p.items, apiError: a.apiError || v.apiError || p.apiError };
}

// search.list por channelId tem atraso de indexação real (o canal pode ter
// dezenas de vídeos e a busca devolver só 1) — usar a playlist de uploads do
// canal via playlistItems.list é o jeito confiável de listar tudo, é a mesma
// fonte que a própria aba "Vídeos" do YouTube usa.
async function getUploadsPlaylistId(apiKey: string, channelId: string) {
  const params = new URLSearchParams({ part: 'contentDetails', id: channelId, key: apiKey });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`).then((r) => r.json());
  const channel = resp.items && resp.items[0];
  return channel?.contentDetails?.relatedPlaylists?.uploads || null;
}

async function listarVideosDaPlaylist(apiKey: string, playlistId: string, maxResults = 50) {
  const params = new URLSearchParams({ part: 'snippet', playlistId, maxResults: String(maxResults), key: apiKey });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`).then((r) => r.json());
  const videos = (resp.items || [])
    .filter((it: any) => it.snippet?.resourceId?.videoId)
    .map(mapPlaylistVideoItem);
  // playlistItems.list não tem parâmetro de ordenação (diferente do
  // search.list) — ordena aqui mesmo por data, mais recente primeiro. Vale
  // pra canal (vídeos do artista) e pra playlist/álbum (faixas), já que os
  // dois usam essa mesma função.
  videos.sort((a, b) => new Date(b._publishedAt).getTime() - new Date(a._publishedAt).getTime());
  return videos.map(({ _publishedAt, ...v }) => v);
}

// Usado pelo link de compartilhar (?play=<videoId>) — pega só os dados de
// exibição de UM vídeo específico, sem precisar buscar por nome.
async function buscarVideoPorId(apiKey: string, videoId: string) {
  const params = new URLSearchParams({ part: 'snippet', id: videoId, key: apiKey });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`).then((r) => r.json());
  const item = resp.items && resp.items[0];
  if (!item) return { video: null, apiError: apiErrorMessage(resp) };
  return {
    video: {
      videoId: item.id,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    },
    apiError: null,
  };
}

// As playlists públicas do canal são a aproximação mais próxima de "álbuns"
// que a API pública do YouTube expõe (não tem endpoint de álbum de verdade).
async function listarPlaylistsDoCanal(apiKey: string, channelId: string) {
  const params = new URLSearchParams({ part: 'snippet', channelId, maxResults: '50', key: apiKey });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/playlists?${params}`).then((r) => r.json());
  return (resp.items || []).map(mapPlaylistItem);
}

async function buscarConteudoDoCanal(apiKey: string, channelId: string) {
  const uploadsId = await getUploadsPlaylistId(apiKey, channelId);
  const [videos, playlists] = await Promise.all([
    uploadsId ? listarVideosDaPlaylist(apiKey, uploadsId, 50) : Promise.resolve([]),
    listarPlaylistsDoCanal(apiKey, channelId),
  ]);
  return { videos, playlists };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('YOUTUBE_API_KEY');
  const url = new URL(req.url);
  const name = (url.searchParams.get('name') || '').trim();
  const channelId = (url.searchParams.get('channelId') || '').trim();
  const playlistId = (url.searchParams.get('playlistId') || '').trim();
  const videoId = (url.searchParams.get('videoId') || '').trim();

  if (!apiKey) {
    return Response.json({ artists: [], videos: [], playlists: [], error: 'Faltando chave do YouTube no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    if (videoId) {
      const cacheKey = `video:${videoId}`;
      const cached = await getCached(cacheKey, CACHE_TTL_VIDEO_MS);
      if (cached) return Response.json(cached, { headers: CORS_HEADERS });

      const { video, apiError } = await buscarVideoPorId(apiKey, videoId);
      const result = { video, error: video ? null : (apiError ? friendlyErrorMessage(apiError) : 'Vídeo não encontrado.') };
      if (video) await setCached(cacheKey, result);
      return Response.json(result, { headers: CORS_HEADERS });
    }

    if (playlistId) {
      const cacheKey = `playlist:${playlistId}`;
      const cached = await getCached(cacheKey, CACHE_TTL_PLAYLIST_MS);
      if (cached) return Response.json(cached, { headers: CORS_HEADERS });

      const videos = await listarVideosDaPlaylist(apiKey, playlistId, 50);
      const result = { artists: [], playlists: [], videos, error: videos.length ? null : 'Playlist vazia ou não encontrada.' };
      if (videos.length) await setCached(cacheKey, result);
      return Response.json(result, { headers: CORS_HEADERS });
    }

    if (channelId) {
      const cacheKey = `channel:${channelId}`;
      const cached = await getCached(cacheKey, CACHE_TTL_CHANNEL_MS);
      if (cached) return Response.json(cached, { headers: CORS_HEADERS });

      const { videos, playlists } = await buscarConteudoDoCanal(apiKey, channelId);
      const result = {
        artists: [], videos, playlists,
        error: (videos.length || playlists.length) ? null : 'Esse canal não tem vídeos encontráveis.',
      };
      if (videos.length || playlists.length) await setCached(cacheKey, result);
      return Response.json(result, { headers: CORS_HEADERS });
    }

    if (!name) {
      return Response.json({ artists: [], videos: [], playlists: [], error: 'Faltando termo de busca.' }, { headers: CORS_HEADERS });
    }

    const cacheKey = `name:${name.toLowerCase()}`;
    const cached = await getCached(cacheKey, CACHE_TTL_SEARCH_MS);
    if (cached) return Response.json(cached, { headers: CORS_HEADERS });

    const { artists, videos, playlists, apiError } = await buscarMisto(apiKey, name);
    const result = {
      artists, videos, playlists,
      error: (artists.length || videos.length || playlists.length) ? null : (apiError ? friendlyErrorMessage(apiError) : `Nada encontrado pra "${name}".`),
    };
    if (artists.length || videos.length || playlists.length) await setCached(cacheKey, result);
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ artists: [], videos: [], playlists: [], error: 'Erro ao consultar YouTube: ' + e.message }, { headers: CORS_HEADERS });
  }
});
