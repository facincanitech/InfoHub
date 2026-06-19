// Supabase Edge Function — webhook do Mercado Pago. Configure essa URL como webhook
// no painel do Mercado Pago (Suas integrações > [seu app] > Webhooks), evento
// "Assinaturas" (subscription_preapproval).
// Deploy: cole essa função numa function chamada "mp-webhook" no painel do Supabase.
// Secrets: MERCADOPAGO_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = 'https://xpscjwcqgdldwtmbbzua.supabase.co';

Deno.serve(async (req: Request) => {
  try {
    const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!accessToken || !serviceRoleKey) {
      return new Response('Faltando secrets no servidor.', { status: 500 });
    }

    const url = new URL(req.url);
    const preapprovalId = url.searchParams.get('id') || url.searchParams.get('data.id');
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const id = preapprovalId || body?.data?.id;

    if (!id) return new Response('ok', { status: 200 });

    const preapproval = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json());

    const email = preapproval.payer_email;
    const isActive = preapproval.status === 'authorized';
    if (!email) return new Response('ok', { status: 200 });

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        email,
        premium: isActive,
        premium_expires_at: isActive ? expiresAt.toISOString() : null,
      }),
    });

    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response('erro: ' + e.message, { status: 500 });
  }
});
