// Supabase Edge Function — checagem de trânsito ambiente pro "modo trânsito" do GPS
// auditivo (sem destino definido). Usa a Google Routes API com routingPreference
// TRAFFIC_AWARE pra comparar duração normal (staticDuration) vs duração com trânsito
// (duration) num trecho curto adiante da posição atual, e classifica a condição.
// Deploy: cole essa função numa function chamada "traffic" no painel do Supabase.
// Secret: GOOGLE_MAPS_API_KEY (mesma chave usada pela function "directions")

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseLatLng(value: string) {
  const [lat, lng] = value.split(',').map(Number);
  return { latitude: lat, longitude: lng };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  const url = new URL(req.url);
  const origem = (url.searchParams.get('origem') || '').trim();
  const destino = (url.searchParams.get('destino') || '').trim();

  if (!apiKey || !origem || !destino) {
    return Response.json({ status: '', error: 'Faltando origem/destino ou chave do Google Maps no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: parseLatLng(origem) } },
        destination: { location: { latLng: parseLatLng(destino) } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        languageCode: 'pt-BR',
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.routes || data.routes.length === 0) {
      const msg = (data.error && data.error.message) || `HTTP ${resp.status}`;
      return Response.json({ status: '', error: `Google Routes: ${msg}` }, { headers: CORS_HEADERS });
    }

    const route = data.routes[0];
    const normal = parseInt((route.staticDuration || route.duration).replace('s', ''), 10);
    const comTransito = parseInt(route.duration.replace('s', ''), 10);
    const ratio = comTransito / normal;

    let status;
    if (ratio < 1.15) status = 'Trânsito tranquilo nas proximidades.';
    else if (ratio < 1.4) status = 'Trânsito moderado nas proximidades.';
    else status = 'Trânsito intenso nas proximidades, considere uma rota alternativa.';

    return Response.json({ status, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ status: '', error: 'Erro ao checar trânsito: ' + e.message }, { headers: CORS_HEADERS });
  }
});
