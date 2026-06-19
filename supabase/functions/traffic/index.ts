// Supabase Edge Function — checagem de trânsito ambiente pro "modo trânsito" do GPS
// auditivo (sem destino definido). Usa o Google Directions com departure_time=now
// pra comparar duração normal vs duração com trânsito num trecho curto adiante da
// posição atual, e classifica a condição.
// Deploy: cole essa função numa function chamada "traffic" no painel do Supabase.
// Secret: GOOGLE_MAPS_API_KEY (mesma chave usada pela function "directions")

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origem)}&destination=${encodeURIComponent(destino)}&departure_time=now&language=pt-BR&key=${apiKey}`;
    const resp = await fetch(directionsUrl).then(r => r.json());
    if (resp.status !== 'OK') {
      return Response.json({ status: '', error: `Google Directions: ${resp.status}` }, { headers: CORS_HEADERS });
    }

    const leg = resp.routes[0].legs[0];
    const normal = leg.duration.value;
    const comTransito = (leg.duration_in_traffic && leg.duration_in_traffic.value) || normal;
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
