// Supabase Edge Function — lista os PDFs de uma pasta pública do Google
// Drive, pro recurso de "colar link do Drive" do Audiobook aceitar link de
// pasta (com vários arquivos), não só de 1 arquivo específico.
// Só funciona com pasta compartilhada como "Qualquer pessoa com o link"
// (Leitor/Visualizador) — chave de API sozinha não acessa pasta privada.
// Deploy: cole essa função numa function chamada "google-drive-folder" no painel do Supabase.
// Secret: GOOGLE_DRIVE_API_KEY (chave de API do Google Cloud com a API do
// Google Drive ativada — pode ser uma chave nova, restrita só a essa API).

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
  const folderId = (url.searchParams.get('folderId') || '').trim();
  if (!folderId) {
    return Response.json({ files: [], error: 'Faltando ID da pasta.' }, { headers: CORS_HEADERS });
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
      // Causa mais comum: pasta não está compartilhada publicamente, ou a
      // chave não tem a API do Drive ativada/restrição errada.
      return Response.json({ files: [], error: resp.error.message || 'Erro ao acessar a pasta do Drive.' }, { headers: CORS_HEADERS });
    }
    const files = (resp.files || []).map((f: any) => ({ id: f.id, name: f.name, size: f.size ? Number(f.size) : null }));
    return Response.json({
      files,
      error: files.length ? null : 'Nenhum PDF encontrado nessa pasta — confere se ela está compartilhada como "Qualquer pessoa com o link".',
    }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ files: [], error: 'Erro ao consultar o Google Drive: ' + e.message }, { headers: CORS_HEADERS });
  }
});
