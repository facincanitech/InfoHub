// Supabase Edge Function — proxies Google Routes API (substituta da antiga Directions
// API, que o Google não deixa mais ativar em projetos novos) pra feature premium
// "GPS auditivo". Chave fica só aqui, nunca no navegador.
// Deploy: cole essa função numa function chamada "directions" no painel do Supabase.
// Secret: GOOGLE_MAPS_API_KEY (precisa de faturamento ativado + "Routes API" habilitada
// no Google Cloud Console)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function formatDuration(seconds: number) {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} minutos`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} horas e ${m} minutos` : `${h} horas`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  const url = new URL(req.url);
  const origem = (url.searchParams.get('origem') || '').trim();
  const destino = (url.searchParams.get('destino') || '').trim();

  if (!apiKey || !origem || !destino) {
    return Response.json({ steps: [], error: 'Faltando origem/destino ou chave do Google Maps no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.legs.steps.navigationInstruction',
      },
      body: JSON.stringify({
        origin: { address: origem },
        destination: { address: destino },
        travelMode: 'DRIVE',
        languageCode: 'pt-BR',
        units: 'METRIC',
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.routes || data.routes.length === 0) {
      const msg = (data.error && data.error.message) || `HTTP ${resp.status}`;
      return Response.json({ steps: [], error: `Google Routes: ${msg}` }, { headers: CORS_HEADERS });
    }

    const route = data.routes[0];
    const durationSec = parseInt(route.duration.replace('s', ''), 10);
    const distanceKm = (route.distanceMeters / 1000).toFixed(1);
    const steps: string[] = [];
    for (const leg of route.legs || []) {
      for (const step of leg.steps || []) {
        const text = step.navigationInstruction && step.navigationInstruction.instructions;
        if (text) steps.push(text);
      }
    }
    steps.unshift(`Rota de ${origem} até ${destino}: ${distanceKm} quilômetros, tempo estimado ${formatDuration(durationSec)}.`);
    return Response.json({ steps, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ steps: [], error: 'Erro ao calcular rota: ' + e.message }, { headers: CORS_HEADERS });
  }
});
