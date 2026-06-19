// Supabase Edge Function — consulta se um e-mail tem assinatura premium ativa.
// Usa a service role key porque a tabela users tem RLS restrita a auth.jwt(), e o
// app não usa Supabase Auth (login é via Google direto) — então não dá pra usar a
// chave pública aqui, precisa ser no servidor.
// Deploy: cole essa função numa function chamada "premium-status" no painel do Supabase.
// Secret: SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = 'https://xpscjwcqgdldwtmbbzua.supabase.co';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = new URL(req.url);
  const email = (url.searchParams.get('email') || '').trim();

  if (!serviceRoleKey || !email) {
    return Response.json({ isPremiumActive: false, error: 'Faltando e-mail ou chave do servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/users_premium_status?email=eq.${encodeURIComponent(email)}&select=is_premium_active`, {
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
    });
    const rows = await resp.json();
    const isPremiumActive = Array.isArray(rows) && rows[0] ? !!rows[0].is_premium_active : false;
    return Response.json({ isPremiumActive, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ isPremiumActive: false, error: 'Erro ao consultar: ' + e.message }, { headers: CORS_HEADERS });
  }
});
