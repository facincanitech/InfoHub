// Supabase Edge Function — cria uma assinatura recorrente (preapproval) no Mercado
// Pago e devolve o link de checkout (init_point) pra redirecionar o usuário.
// Deploy: cole essa função numa function chamada "subscription" no painel do Supabase.
// Secret: MERCADOPAGO_ACCESS_TOKEN

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
  const url = new URL(req.url);
  const email = (url.searchParams.get('email') || '').trim();
  const backUrl = (url.searchParams.get('back_url') || '').trim();

  if (!accessToken || !email) {
    return Response.json({ init_point: '', error: 'Faltando e-mail ou chave do Mercado Pago no servidor.' }, { headers: CORS_HEADERS });
  }

  try {
    const resp = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'InfoHub Premium',
        payer_email: email,
        back_url: backUrl || 'https://facincanitech.github.io/InfoHub/',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: 9.9,
          currency_id: 'BRL',
        },
        status: 'pending',
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.init_point) {
      return Response.json({ init_point: '', error: `Mercado Pago: ${data.message || resp.status}` }, { headers: CORS_HEADERS });
    }
    return Response.json({ init_point: data.init_point, error: null }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ init_point: '', error: 'Erro ao criar assinatura: ' + e.message }, { headers: CORS_HEADERS });
  }
});
