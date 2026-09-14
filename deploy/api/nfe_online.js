// Vercel Serverless Function — debug: estrutura completa de um pedido faturado
// Objetivo: descobrir campos de NF, DIFAL e FCP no pedido do Omie Online

export const maxDuration = 60;

const KEY_ONLINE = '7167467499192';
const SEC_ONLINE = '4e3e8e18fbefee789318d4e63108c9c1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function omie(url, call, param) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: KEY_ONLINE, app_secret: SEC_ONLINE, param: [param] })
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

  // 1) Pega 5 pedidos e mostra a estrutura completa do 1º — queremos ver campos NF/DIFAL
  const r1 = await omie(
    'https://app.omie.com.br/api/v1/produtos/pedido/', 'ListarPedidos',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N' }
  );
  const peds = r1.data.pedido_venda_produto || [];
  const p0 = peds[0] || {};

  // Achata o pedido completo para ver todos os campos em todos os níveis
  function achatar(obj, prefixo='') {
    const resultado = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const chave = prefixo ? prefixo + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(resultado, achatar(v, chave));
      } else if (Array.isArray(v)) {
        resultado[chave] = `array(${v.length})`;
        if (v[0] && typeof v[0] === 'object') {
          Object.assign(resultado, achatar(v[0], chave + '[0]'));
        }
      } else {
        resultado[chave] = v;
      }
    }
    return resultado;
  }

  const plano = achatar(p0);
  // Filtra campos relacionados a NF, chave, DIFAL, FCP, emissao, imposto
  const nf_campos = {};
  const difal_campos = {};
  for (const [k, v] of Object.entries(plano)) {
    const kl = k.toLowerCase();
    if (kl.includes('nf') || kl.includes('chave') || kl.includes('emis') || kl.includes('serie') || kl.includes('numero')) {
      nf_campos[k] = v;
    }
    if (kl.includes('difal') || kl.includes('icms') || kl.includes('fcp') || kl.includes('dest') || kl.includes('uf')) {
      difal_campos[k] = v;
    }
  }

  resultados.estrutura_pedido = {
    erro: r1.err,
    total_pedidos: r1.data.total_de_registros,
    campos_raiz_1o_pedido: Object.keys(p0),
    campos_nf_encontrados: nf_campos,
    campos_difal_encontrados: difal_campos,
    todos_campos_achatados: plano  // dump completo
  };

  await sleep(800);

  // 2) Testa filtro de data no endpoint de pedidos
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const r2 = await omie(
    'https://app.omie.com.br/api/v1/produtos/pedido/', 'ListarPedidos',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N',
      filtrar_por_data_de: hoje, filtrar_por_data_ate: hoje }
  );
  resultados.filtro_data_hoje = {
    erro: r2.err,
    total: r2.data.total_de_registros,
    campos_raiz: Object.keys(r2.data)
  };

  return res.status(200).json({ _debug: true, resultados });
}
