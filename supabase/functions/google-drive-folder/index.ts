// Supabase Edge Function — dois modos:
// 1. ?folderId=X  — lista os PDFs de uma pasta pública do Google Drive
// 2. ?fileId=X    — baixa o conteúdo de um PDF e devolve pro app (proxy)
//
// O modo proxy (fileId) existe porque o truque antigo de download direto
// (drive.google.com/uc?export=download) é instável e cada vez mais
// bloqueado pelo Google, mostrando página de aviso em vez do PDF bruto.
// O endpoint oficial da Drive API v3 (files.get?alt=media) é confiável,
// mas precisa da chave de API — por isso passa pelo servidor, não pelo app.
//
// Deploy: cole essa função numa function chamada "google-drive-folder".
// Secret: GOOGLE_DRIVE_API_KEY (chave de API com Google Drive API ativada).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const apiKey = Deno.env.get('GOOGLE_DRIVE_API_KEY');
  if (!apiKey) {
    return Response.json({ files: [], error: 'Faltando chave da API do Google Drive no servidor.' }, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const fileId = (url.searchParams.get('fileId') || '').trim();
  const folderId = (url.searchParams.get('folderId') || '').trim();

  // Modo 2: proxy de download do PDF — usa o endpoint oficial da API em vez
  // do uc?export=download que o Google tem progressivamente bloqueado.
  if (fileId) {
    try {
      const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${apiKey}`;
      const resp = await fetch(driveUrl);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.status.toString());
        return Response.json({ error: `Não consegui baixar o arquivo: ${errText}` }, { headers: CORS_HEADERS, status: 502 });
      }
      // Repassa o conteúdo do PDF diretamente, adicionando os headers CORS
      // necessários pro app conseguir ler — o Drive não os inclui por padrão.
      return new Response(resp.body, {
        headers: {
          'Content-Type': 'application/pdf',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (e) {
      return Response.json({ error: 'Erro ao baixar arquivo do Drive: ' + (e instanceof Error ? e.message : String(e)) }, { headers: CORS_HEADERS, status: 500 });
    }
  }

  // Modo 1: listagem de PDFs de uma pasta pública.
  if (!folderId) {
    return Response.json({ files: [], error: 'Faltando folderId ou fileId.' }, { headers: CORS_HEADERS });
  }

  try {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
      fields: 'files(id,name,size)',
      pageSize: '200',
      key: apiKey,
    });
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`).then((r) => r.json());
    if (resp.error) {
      return Response.json({ files: [], error: resp.error.message || 'Erro ao acessar a pasta do Drive.' }, { headers: CORS_HEADERS });
    }
    const files = (resp.files || []).map((f: any) => ({ id: f.id, name: f.name, size: f.size ? Number(f.size) : null }));
    return Response.json({
      files,
      error: files.length ? null : 'Nenhum PDF encontrado nessa pasta — confere se ela está compartilhada como "Qualquer pessoa com o link".',
    }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ files: [], error: 'Erro ao consultar o Google Drive: ' + (e instanceof Error ? e.message : String(e)) }, { headers: CORS_HEADERS });
  }
});
