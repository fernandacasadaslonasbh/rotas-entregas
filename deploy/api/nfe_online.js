// Vercel Serverless Function — debug: busca NFs via pedidos do Omie Online
// O fluxo: pedido entra no CD → NF emitida no Online a partir do pedido

export const maxDuration = 60;

const KEY_ONLINE = '7167467499192';
const SEC_ONLINE = '4e3e8e18fbefee789318d4e63108c9c1';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function omie(url, call, param, key, secret) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: key, app_secret: secret, param: [param] })
  });
  const d = await r.json();
  return { data: d, err: d.faultstring || null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const resultados = {};

  // 1) ListarPedidos no Omie Online — pega os pedidos e vê se têm NF vinculada
  const r1 = await omie(
    'https://app.omie.com.br/api/v1/produtos/pedido/',
    'ListarPedidos',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N' },
    KEY_ONLINE, SEC_ONLINE
  );
  const ped = r1.data.pedido_venda_produto || r1.data.pedido_venda || r1.data.Pedidos || [];
  const primPed = ped[0] || {};
  resultados.pedido_ListarPedidos = {
    erro: r1.err,
    campos_raiz: Object.keys(r1.data),
    total: r1.data.total_de_registros || r1.data.qtd_total_registros || '?',
    qtd: ped.length,
    campos_1o_pedido: Object.keys(primPed),
    // Mostra sub-objetos do 1º pedido (cabecalho, inf_adic, etc.)
    sub_objetos: Object.entries(primPed).filter(([,v]) => typeof v === 'object').map(([k,v]) => ({
      campo: k, subcampos: Object.keys(v||{})
    }))
  };

  await sleep(800);

  // 2) ListarContasReceber no Omie Online — ver se NFs aparecem aqui
  const r2 = await omie(
    'https://app.omie.com.br/api/v1/financas/contareceber/',
    'ListarContasReceber',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N' },
    KEY_ONLINE, SEC_ONLINE
  );
  const titulos = r2.data.conta_receber_cadastro || r2.data.ContaReceberCadastro || [];
  const primTit = titulos[0] || {};
  resultados.financas_ContasReceber = {
    erro: r2.err,
    campos_raiz: Object.keys(r2.data),
    total: r2.data.total_de_registros || '?',
    qtd: titulos.length,
    campos_1o_titulo: Object.keys(primTit),
    amostra_nf: titulos.slice(0,3).map(t => ({
      nf: t.numero_documento_fiscal || t.numero_nf || t.nNF || t.cNumNF,
      valor: t.valor_documento,
      data: t.data_vencimento || t.data_emissao
    }))
  };

  await sleep(800);

  // 3) PesquisarPedidos — busca pedidos com NF emitida (cSituação faturado)
  const r3 = await omie(
    'https://app.omie.com.br/api/v1/produtos/pedido/',
    'PesquisarPedidos',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N',
      filtrar_por_etapa: '70'  // etapa 70 = faturado / NF emitida
    },
    KEY_ONLINE, SEC_ONLINE
  );
  const ped3 = r3.data.pedido_venda_produto || r3.data.pedido_venda || r3.data.Pedidos || [];
  resultados.pedido_PesquisarFaturados = {
    erro: r3.err,
    campos_raiz: Object.keys(r3.data),
    total: r3.data.total_de_registros || r3.data.qtd_total_registros || '?',
    qtd: ped3.length,
    amostra: ped3.slice(0,2).map(p => {
      const txt = JSON.stringify(p);
      const nf_match = txt.match(/["\s](n[Nn][Ff]|numero_nf|chNFe|nNF)["\s]*:[\s"]*([^",\s}{]+)/);
      return { tem_nf_texto: txt.includes('nNF') || txt.includes('numero_nf') || txt.includes('chNFe'),
               chave_nf: nf_match?.[2] };
    })
  };

  return res.status(200).json({ _debug: true, resultados });
}
