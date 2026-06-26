// Supabase Edge Function — autocompletar de endereço via Photon (OpenStreetMap),
// 100% gratuito, sem chave nenhuma. Substituiu o Google Places Autocomplete pra
// cortar custo — essa parte (Places) é cara no Google, diferente do Routes
// (trânsito/navegação), que continua no Google por não ter alternativa gratuita
// com trânsito em tempo real.
// Deploy: cole essa função numa function chamada "places-autocomplete" no painel do Supabase.
// Sem secret necessário.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function formatAddress(props: any) {
  const parts: string[] = [];
  if (props.street) {
    parts.push(props.housenumber ? `${props.street}, ${props.housenumber}` : props.street);
  } else if (props.name) {
    parts.push(props.name);
  }
  const local = [props.district, props.city, props.state].filter(Boolean).join(', ');
  if (local) parts.push(local);
  return parts.join(' - ');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const input = (url.searchParams.get('input') || '').trim();
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lng = parseFloat(url.searchParams.get('lng') || '');

  if (!input) {
    return Response.json({ suggestions: [], error: 'Faltando texto digitado.' }, { headers: CORS_HEADERS });
  }

  try {
    const params = new URLSearchParams({ q: input, limit: '5' });
    if (!isNaN(lat) && !isNaN(lng)) {
      params.set('lat', String(lat));
      params.set('lon', String(lng));
    }
    const resp = await fetch(`https://photon.komoot.io/api/?${params}`, {
      headers: { 'User-Agent': 'SonorHub/1.0 (briefing app)' },
    });
    if (!resp.ok) {
      return Response.json({ suggestions: [], error: `Photon: HTTP ${resp.status}` }, { headers: CORS_HEADERS });
    }
    const data = await resp.json();
    const seen = new Set<string>();
    const suggestions: { text: string }[] = [];
    for (const feature of data.features || []) {
      const text = formatAddress(feature.properties || {});
      if (!text || seen.has(text)) continue;
      seen.add(text);
      suggestions.push({ text });
    }
    return Response.json({ suggestions, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ suggestions: [], error: 'Erro ao buscar endereço: ' + e.message }, { headers: CORS_HEADERS });
  }
});
