// Supabase Edge Function — autocompletar de endereço (Google Places API Autocomplete,
// New) pro campo de destino do GPS auditivo. Resolve o problema de digitar rua/número
// solto e não bater com nada real — aqui você escolhe de uma lista de endereços de
// verdade enquanto digita.
// Deploy: cole essa função numa function chamada "places-autocomplete" no painel do Supabase.
// Secret: GOOGLE_MAPS_API_KEY (mesma chave das outras functions de GPS — precisa ter
// "Places API (New)" habilitada, já usada pelo places-nearby)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  const url = new URL(req.url);
  const input = (url.searchParams.get('input') || '').trim();
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lng = parseFloat(url.searchParams.get('lng') || '');

  if (!apiKey || !input) {
    return Response.json({ suggestions: [], error: 'Faltando texto digitado ou chave do Google Maps no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    const body: any = {
      input,
      languageCode: 'pt-BR',
      regionCode: 'BR',
    };
    if (!isNaN(lat) && !isNaN(lng)) {
      body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } };
    }

    const resp = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data.error && data.error.message) || `HTTP ${resp.status}`;
      return Response.json({ suggestions: [], error: `Google Places: ${msg}` }, { headers: CORS_HEADERS });
    }

    const suggestions = (data.suggestions || [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({ text: p.text && p.text.text }))
      .filter((s: any) => s.text);

    return Response.json({ suggestions, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ suggestions: [], error: 'Erro ao buscar endereço: ' + e.message }, { headers: CORS_HEADERS });
  }
});
