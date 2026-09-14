// Vercel Serverless Function — debug: testa vários endpoints no Omie Online
// para descobrir onde ficam as NFs emitidas

export const maxDuration = 60;

// Omie Online (loja Shopee)
const KEY    = '7167467499192';
const SECRET = '4e3e8e18fbefee789318d4e63108c9c1';

async function omie(url, call, param) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: KEY, app_secret: SECRET, param: [param] })
  });
  const d = await r.json();
  return { data: d, err: d.faultstring || d.erro || null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const resultados = {};

  // 1) ListarNFe em produtos/nfe/ (tentativa conhecida, 0 resultados)
  const r1 = await omie('https://app.omie.com.br/api/v1/produtos/nfe/', 'ListarNFe',
    { nPagina: 1, nRegPorPagina: 20 });
  resultados.nfe_ListarNFe = {
    erro: r1.err,
    campos: Object.keys(r1.data),
    nTotRegistros: r1.data.nTotRegistros ?? r1.data.nRegistros ?? '?',
    listagemNfe: Array.isArray(r1.data.listagemNfe) ? r1.data.listagemNfe.length : 'n/a'
  };

  // 2) ListarPedidos — pedidos de venda no Omie Online
  const r2 = await omie('https://app.omie.com.br/api/v1/produtos/pedido/', 'ListarPedidos',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N' });
  const ped = r2.data.pedido_venda_produto || r2.data.pedido_venda || r2.data.pedidos || [];
  resultados.pedido_ListarPedidos = {
    erro: r2.err,
    campos_raiz: Object.keys(r2.data),
    total: r2.data.total_de_registros || r2.data.nTotRegistros || r2.data.qtd_total_registros || '?',
    qtd_nesta_pagina: ped.length,
    campos_1o_pedido: ped.length > 0 ? Object.keys(ped[0]) : [],
    tem_nf: ped.length > 0 ? JSON.stringify(ped[0]).includes('nf') || JSON.stringify(ped[0]).includes('NF') : false
  };

  // 3) ListarPedidos com filtro de situacao diferente
  const r3 = await omie('https://app.omie.com.br/api/v1/produtos/pedido/', 'ListarPedidos',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N', filtrarPorTipoPedido: 'S' });
  resultados.pedido_comFiltro = {
    erro: r3.err,
    campos_raiz: Object.keys(r3.data).slice(0, 10)
  };

  // 4) ConsultarNFe — ver se o endpoint responde (mesmo sem nCodNF)
  const r4 = await omie('https://app.omie.com.br/api/v1/produtos/nfe/', 'ConsultarNFe',
    { nCodNF: 0, cChaveNFe: '' });
  resultados.nfe_ConsultarNFe = {
    erro: r4.err,
    campos: Object.keys(r4.data)
  };

  return res.status(200).json({ _debug: true, resultados });
}
