/**
 * Vercel Serverless Function — Sincroniza catálogo + kits + CMC do Omie → Firebase
 * Chamado pelo cron (15:30 BRT = 18:30 UTC) e pelo botão "Sincronizar Agora" no Admin.
 *
 * maxDuration: 60  (Vercel Hobby suporta até 60s)
 */

export const maxDuration = 60;

const APP_KEY    = '5490393509601';
const APP_SECRET = '63b1bb40caba6f37c7814735bf637acd';
const FIREBASE   = 'https://casa-das-lonas-rotas-default-rtdb.firebaseio.com';
const URL_PROD   = 'https://app.omie.com.br/api/v1/geral/produtos/';
const URL_EST    = 'https://app.omie.com.br/api/v1/estoque/resumo/';

async function omie(url, call, param) {
  const r = await fetch(url, {
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
  let pagina = 1, totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const data = await omie(URL_PROD, 'ListarProdutos', [{
      pagina, registros_por_pagina: 100,
      apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N', inativo: 'N'
    }]);
    if (data.faultstring) break;
    totalPaginas = data.total_de_paginas || 1;
    for (const p of (data.produto_servico_cadastro || [])) {
      const sku = String(p.codigo || '').trim().toLowerCase();
      const nome = String(p.descricao || '').trim();
      const id   = p.codigo_produto;
      const tipo = String(p.tipoItem || '').trim();
      if (sku && nome) {
        catalogo[sku] = nome;
        if (id) { idParaSku[id] = sku; skuParaId[sku] = id; }
        if (tipo === 'KT') kits.push(sku);
      }
    }
    pagina++;
  }
  return { catalogo, idParaSku, skuParaId, kits };
}

async function buscarKits(kits, idParaSku, catalogo) {
  const composicoes = {};
  await Promise.all(kits.map(async (sku) => {
    const data = await omie(URL_PROD, 'ConsultarProduto', [{ codigo: sku }]);
    const comps = (data.componentes_kit || []).map(c => ({
      sku:  idParaSku[c.codigo_produto_componente] || '',
      nome: catalogo[idParaSku[c.codigo_produto_componente] || ''] || '',
      qtd:  parseFloat(c.quantidade_componente || 0)
    })).filter(c => c.sku && c.qtd > 0);
    if (comps.length) composicoes[sku] = comps;
  }));
  return composicoes;
}

async function buscarCmc(skus) {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const cmc  = {};
  const BATCH = 10;
  for (let i = 0; i < skus.length; i += BATCH) {
    await Promise.all(skus.slice(i, i + BATCH).map(async (sku) => {
      const data = await omie(URL_EST, 'ObterEstoqueProduto', [{
        cEAN: '', nIdProduto: 0, cCodigo: sku, xCodigo: '', dDia: hoje
      }]);
      const v = (data.listaEstoque || [])[0]?.nCMC;
      if (v && parseFloat(v) > 0) cmc[sku] = parseFloat(v);
    }));
  }
  return cmc;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fase 1: listar produtos
    const { catalogo, idParaSku, skuParaId, kits } = await listarProdutos();

    // Fase 2: composição dos kits (em paralelo)
    const composicoes = await buscarKits(kits, idParaSku, catalogo);

    // Fase 3: CMC dos não-kits (em paralelo, lotes de 10)
    const kitsSet = new Set(kits);
    const skusNaoKit = Object.keys(catalogo).filter(s => !kitsSet.has(s));
    const cmcMap = await buscarCmc(skusNaoKit);

    // Fase 4: salvar no Firebase
    await Promise.all([
      firebase('cdl_config/catalogo', catalogo),
      Object.keys(composicoes).length ? firebase('cdl_config/catalogo_kits', composicoes) : Promise.resolve(),
      Object.keys(cmcMap).length       ? firebase('cdl_config/catalogo_cmc', cmcMap)       : Promise.resolve(),
      Object.keys(skuParaId).length    ? firebase('cdl_config/catalogo_produto_ids', skuParaId) : Promise.resolve(),
    ]);

    const ultima = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    await firebase('cdl_config/ultima_sincronizacao', ultima);

    return res.status(200).json({
      ok: true,
      produtos: Object.keys(catalogo).length,
      kits: Object.keys(composicoes).length,
      cmc: Object.keys(cmcMap).length,
      ultima
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, erro: String(e.message) });
  }
}
