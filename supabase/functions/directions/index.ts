// Supabase Edge Function — proxies Google Routes API pra feature premium "GPS
// auditivo". Chave fica só aqui, nunca no navegador.
//
// Devolve cada passo com a localização (lat/lng) de onde a manobra acontece, pra
// o cliente conseguir tocar o próximo passo só quando o usuário chegar perto de
// verdade (em vez de ler tudo de uma vez, parado) — sem isso o app "lê o trajeto
// inteiro" ao mesmo tempo, o que não é como um GPS de verdade funciona.
//
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

// A origem vem como "lat,lng" (geolocalização do navegador) — a Routes API exige um
// waypoint do tipo location/latLng pra coordenadas, não aceita como Address.
function toWaypoint(value: string) {
  const coordMatch = value.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    return { location: { latLng: { latitude: parseFloat(coordMatch[1]), longitude: parseFloat(coordMatch[2]) } } };
  }
  return { address: value };
}

// Decodifica a polyline codificada do Google (algoritmo padrão, precisão 5).
function decodePolyline(encoded: string): [number, number][] {
  let index = 0, lat = 0, lng = 0;
  const coordinates: [number, number][] = [];
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lat / 1e5, lng / 1e5]);
  }
  return coordinates;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Os trechos de trânsito (speedReadingIntervals) vêm como índice de ponto da
// polyline, não como metro da rota — decodifica a polyline e soma a distância
// acumulada pra converter "índice X" em "a Y metros do início".
function trafficWarningsFromLeg(leg: any, encodedPolyline: string) {
  const intervals = (leg.travelAdvisory && leg.travelAdvisory.speedReadingIntervals) || [];
  const slow = intervals.filter((i: any) => i.speed === 'SLOW' || i.speed === 'TRAFFIC_JAM');
  if (slow.length === 0 || !encodedPolyline) return [];

  const points = decodePolyline(encodedPolyline);
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
  }

  return slow
    .map((interval: any) => {
      const idx = Math.min(interval.startPolylinePointIndex || 0, cumulative.length - 1);
      return { distanceMeters: Math.round(cumulative[idx]), severity: interval.speed };
    })
    .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  const url = new URL(req.url);
  const origem = (url.searchParams.get('origem') || '').trim();
  const destino = (url.searchParams.get('destino') || '').trim();

  if (!apiKey || !origem || !destino) {
    return Response.json({ summary: '', steps: [], error: 'Faltando origem/destino ou chave do Google Maps no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // routingPreference TRAFFIC_AWARE muda o SKU de cobrança do Google (Essentials
        // -> Pro, ~2x o preço por chamada) — decisão consciente: o valor de avisar
        // trânsito compensa, mesmo no uso mais pesado a margem do Premium ainda fecha.
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.steps.endLocation,routes.legs.steps.distanceMeters,routes.legs.travelAdvisory.speedReadingIntervals',
      },
      body: JSON.stringify({
        origin: toWaypoint(origem),
        destination: toWaypoint(destino),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        languageCode: 'pt-BR',
        units: 'METRIC',
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.routes || data.routes.length === 0) {
      const msg = (data.error && data.error.message) || `HTTP ${resp.status}`;
      return Response.json({ summary: '', steps: [], error: `Google Routes: ${msg}` }, { headers: CORS_HEADERS });
    }

    const route = data.routes[0];
    const durationSec = parseInt(route.duration.replace('s', ''), 10);
    const distanceKm = (route.distanceMeters / 1000).toFixed(1);
    const steps: { text: string; lat: number; lng: number; maneuver: string | null; distanceMeters: number }[] = [];
    for (const leg of route.legs || []) {
      for (const step of leg.steps || []) {
        const text = step.navigationInstruction && step.navigationInstruction.instructions;
        const loc = step.endLocation && step.endLocation.latLng;
        const maneuver = (step.navigationInstruction && step.navigationInstruction.maneuver) || null;
        if (text && loc) steps.push({ text, lat: loc.latitude, lng: loc.longitude, maneuver, distanceMeters: step.distanceMeters || 0 });
      }
    }
    const summary = `Rota até ${destino}: ${distanceKm} quilômetros, tempo estimado ${formatDuration(durationSec)}.`;
    const encodedPolyline = route.polyline && route.polyline.encodedPolyline;
    const trafficWarnings = (route.legs || []).flatMap((leg: any) => trafficWarningsFromLeg(leg, encodedPolyline));
    return Response.json({ summary, steps, trafficWarnings, totalDistanceMeters: route.distanceMeters, totalDurationSec: durationSec, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ summary: '', steps: [], error: 'Erro ao calcular rota: ' + e.message }, { headers: CORS_HEADERS });
  }
});
