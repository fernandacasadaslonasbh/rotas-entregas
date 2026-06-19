/**
 * Vercel Serverless Function — Sincroniza catálogo + kits + IDs do Omie → Firebase
 * CMC removido (atualizado em tempo real pelo botão Estoque CD)
 * Tempo estimado: ~25s para 1.300+ produtos e 420+ kits
 */

export const maxDuration = 60;

const APP_KEY    = '5490393509601';
const APP_SECRET = '63b1bb40caba6f37c7814735bf637acd';
const FIREBASE   = 'https://casa-das-lonas-rotas-default-rtdb.firebaseio.com';
const URL_PROD   = 'https://app.omie.com.br/api/v1/geral/produtos/';

async function omie(call, param) {
  const r = await fetch(URL_PROD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param })
  });
  return r.json();
}

async function firebase(path, data) {
  await fetch(`${FIREBASE}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function listarProdutos() {
  const catalogo = {}, idParaSku = {}, skuParaId = {}, kits = [];

  // Busca página 1 para saber o total de páginas
  const first = await omie('ListarProdutos', [{
    pagina: 1, registros_por_pagina: 100,
    apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N', inativo: 'N'
  }]);
  if (first.faultstring) return { catalogo, idParaSku, skuParaId, kits };
  const totalPaginas = first.total_de_paginas || 1;

  // Processa todas as páginas em paralelo (lotes de 5 para não sobrecarregar)
  const paginas = Array.from({ length: totalPaginas }, (_, i) => i + 1);
  const BATCH_PAG = 5;
  for (let i = 0; i < paginas.length; i += BATCH_PAG) {
    const results = await Promise.all(paginas.slice(i, i + BATCH_PAG).map(p =>
      p === 1 ? Promise.resolve(first)
              : omie('ListarProdutos', [{
                  pagina: p, registros_por_pagina: 100,
                  apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N', inativo: 'N'
                }])
    ));
    for (const data of results) {
      if (data.faultstring) continue;
      for (const p of (data.produto_servico_cadastro || [])) {
        const sku  = String(p.codigo || '').trim().toLowerCase();
        const nome = String(p.descricao || '').trim();
        const id   = p.codigo_produto;
        const tipo = String(p.tipoItem || '').trim();
        if (sku && nome) {
          catalogo[sku] = nome;
          if (id) { idParaSku[id] = sku; skuParaId[sku] = id; }
          if (tipo === 'KT') kits.push(sku);
        }
      }
    }
  }
  return { catalogo, idParaSku, skuParaId, kits };
}

async function buscarKits(kits, idParaSku, catalogo) {
  const composicoes = {};
  const BATCH = 25; // aumentado de 10 para 25 para processar mais rápido
  for (let i = 0; i < kits.length; i += BATCH) {
    await Promise.all(kits.slice(i, i + BATCH).map(async (sku) => {
      try {
        const data = await omie('ConsultarProduto', [{ codigo: sku }]);
        const comps = (data.componentes_kit || []).map(c => ({
          sku:  idParaSku[c.codigo_produto_componente] || '',
          nome: catalogo[idParaSku[c.codigo_produto_componente] || ''] || '',
          qtd:  parseFloat(c.quantidade_componente || 0)
        })).filter(c => c.sku && c.qtd > 0);
        if (comps.length) composicoes[sku] = comps;
      } catch {}
    }));
  }
  return composicoes;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { catalogo, idParaSku, skuParaId, kits } = await listarProdutos();
    const composicoes = await buscarKits(kits, idParaSku, catalogo);

    const ultima = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    await Promise.all([
      firebase('cdl_config/catalogo', catalogo),
      Object.keys(composicoes).length ? firebase('cdl_config/catalogo_kits', composicoes) : Promise.resolve(),
      Object.keys(skuParaId).length   ? firebase('cdl_config/catalogo_produto_ids', skuParaId) : Promise.resolve(),
      firebase('cdl_config/ultima_sincronizacao', ultima),
    ]);

    return res.status(200).json({
      ok: true,
      produtos: Object.keys(catalogo).length,
      kits: Object.keys(composicoes).length,
      ids: Object.keys(skuParaId).length,
      ultima
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, erro: String(e.message) });
  }
}
