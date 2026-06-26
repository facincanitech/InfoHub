// Supabase Edge Function — busca de música/vídeo no YouTube pro MultiSonor.
// Três modos:
//  - sem channelId/playlistId: busca mista (artistas + vídeos) pelo termo,
//    pra mostrar a grade de artistas + lista de músicas/vídeos.
//  - com channelId: lista os vídeos do canal (clicou num artista) + as
//    playlists públicas dele (a aproximação mais próxima de "álbuns" que a
//    API pública do YouTube expõe).
//  - com playlistId: lista os vídeos daquela playlist/álbum específico.
// Deploy: cole essa função numa function chamada "youtube-music" no painel do Supabase.
// Secret: YOUTUBE_API_KEY (mesma chave já usada em "Canais do YouTube")

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function mapVideoItem(it: any) {
  return {
    videoId: it.id.videoId,
    title: it.snippet.title,
    channelTitle: it.snippet.channelTitle,
    thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
  };
}

// Item de playlistItems.list tem formato diferente do de search.list — o id
// do vídeo vem em snippet.resourceId.videoId, não em id.videoId.
function mapPlaylistVideoItem(it: any) {
  return {
    videoId: it.snippet.resourceId?.videoId,
    title: it.snippet.title,
    channelTitle: it.snippet.videoOwnerChannelTitle || it.snippet.channelTitle,
    thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
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

async function buscarArtistas(apiKey: string, termo: string) {
  const params = new URLSearchParams({
    part: 'snippet', q: termo, type: 'channel', order: 'relevance', maxResults: '8', key: apiKey,
  });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`).then((r) => r.json());
  return (resp.items || []).map(mapChannelItem);
}

async function buscarVideos(apiKey: string, termo: string) {
  const params = new URLSearchParams({
    part: 'snippet', q: termo, type: 'video', order: 'date', maxResults: '15', key: apiKey,
  });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`).then((r) => r.json());
  return (resp.items || []).map(mapVideoItem);
}

async function buscarMisto(apiKey: string, termo: string) {
  const [artists, videos] = await Promise.all([
    buscarArtistas(apiKey, termo),
    buscarVideos(apiKey, termo),
  ]);
  return { artists, videos };
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
  return (resp.items || [])
    .filter((it: any) => it.snippet?.resourceId?.videoId)
    .map(mapPlaylistVideoItem);
}

// As playlists públicas do canal são a aproximação mais próxima de "álbuns"
// que a API pública do YouTube expõe (não tem endpoint de álbum de verdade).
async function listarPlaylistsDoCanal(apiKey: string, channelId: string) {
  const params = new URLSearchParams({ part: 'snippet', channelId, maxResults: '20', key: apiKey });
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

  if (!apiKey) {
    return Response.json({ artists: [], videos: [], playlists: [], error: 'Faltando chave do YouTube no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    if (playlistId) {
      const videos = await listarVideosDaPlaylist(apiKey, playlistId, 50);
      return Response.json({
        artists: [], playlists: [], videos,
        error: videos.length ? null : 'Playlist vazia ou não encontrada.',
      }, { headers: CORS_HEADERS });
    }

    if (channelId) {
      const { videos, playlists } = await buscarConteudoDoCanal(apiKey, channelId);
      return Response.json({
        artists: [], videos, playlists,
        error: (videos.length || playlists.length) ? null : 'Esse canal não tem vídeos encontráveis.',
      }, { headers: CORS_HEADERS });
    }

    if (!name) {
      return Response.json({ artists: [], videos: [], playlists: [], error: 'Faltando termo de busca.' }, { headers: CORS_HEADERS });
    }

    const { artists, videos } = await buscarMisto(apiKey, name);
    return Response.json({
      artists, videos, playlists: [],
      error: (artists.length || videos.length) ? null : `Nada encontrado pra "${name}".`,
    }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ artists: [], videos: [], playlists: [], error: 'Erro ao consultar YouTube: ' + e.message }, { headers: CORS_HEADERS });
  }
});
