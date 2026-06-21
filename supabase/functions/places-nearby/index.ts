// Supabase Edge Function — busca lugares próximos via Overpass API (OpenStreetMap),
// 100% gratuito, sem chave nenhuma. Substituiu o Google Places Nearby Search pra
// cortar custo. Sem nota/avaliação (OSM não tem isso) — só nome e distância.
// Deploy: cole essa função numa function chamada "places-nearby" no painel do Supabase.
// Sem secret necessário.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mapeia nossas categorias pra tags do OpenStreetMap (amenity=...)
const TYPE_TO_OSM_TAG: Record<string, string> = {
  gas_station: 'fuel',
  restaurant: 'restaurant',
  pharmacy: 'pharmacy',
};

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lng = parseFloat(url.searchParams.get('lng') || '');
  const type = (url.searchParams.get('types') || '').trim();
  const radius = parseFloat(url.searchParams.get('radius') || '2000');
  const osmTag = TYPE_TO_OSM_TAG[type];

  if (!osmTag || isNaN(lat) || isNaN(lng)) {
    return Response.json({ places: [], error: 'Faltando lat/lng/tipo válido.' }, { headers: CORS_HEADERS });
  }

  try {
    const query = `[out:json][timeout:25];node["amenity"="${osmTag}"](around:${radius},${lat},${lng});out 5;`;
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!resp.ok) {
      return Response.json({ places: [], error: `Overpass: HTTP ${resp.status}` }, { headers: CORS_HEADERS });
    }
    const data = await resp.json();
    const places = (data.elements || [])
      .filter((el: any) => el.lat && el.lon)
      .map((el: any) => ({
        id: String(el.id),
        name: (el.tags && (el.tags.name || el.tags.brand)) || 'Sem nome',
        distance: Math.round(distanceMeters(lat, lng, el.lat, el.lon)),
        rating: null, // OSM não tem avaliação
      }))
      .sort((a: any, b: any) => a.distance - b.distance);
    return Response.json({ places, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ places: [], error: 'Erro ao buscar lugares: ' + e.message }, { headers: CORS_HEADERS });
  }
});
