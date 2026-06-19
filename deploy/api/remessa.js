/**
 * Vercel Serverless Function — proxy para Omie IncluirRemessa (Matriz↔Filial)
 * POST { orig: "Matriz"|"Filial", data_previsao: "DD/MM/YYYY", itens: [{sku, quantidade, valor_unitario}] }
 * Busca o nCodProd de cada SKU no sistema da origem antes de criar a remessa.
 */

export const maxDuration = 60;

const OMIE_PROD_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';
const OMIE_REM_URL  = 'https://app.omie.com.br/api/v1/produtos/remessa/';

const CONFIG = {
  Matriz: {
    app_key:    '3554224779105',
    app_secret: '6466fbd2b0bbfebc37b597face75280c',
    nCodCli:    10136107449,  // CASA DAS LONAS LTDA - FILIAL no sistema Matriz
  },
  Filial: {
    app_key:    '3557069109594',
    app_secret: '59d446121fb05b3c3e72d76f180e8e93',
    nCodCli:    10138027795,  // CASA DAS LONAS LTDA - MATRIZ no sistema Filial
  }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function omieCall(url, app_key, app_secret, call, param) {
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ call, app_key, app_secret, param: [param] })
  });
  return r.json();
}

async function buscarNCodProd(sku, cfg) {
  try {
    const data = await omieCall(OMIE_PROD_URL, cfg.app_key, cfg.app_secret, 'ConsultarProduto', {
      codigo: sku,
      codigo_produto: 0,
      codigo_produto_integracao: ''
    });
    const cod = data.codigo_produto;
    if (cod) return cod;
    // Fallback: ListarProdutos filtrado pelo código
    const lista = await omieCall(OMIE_PROD_URL, cfg.app_key, cfg.app_secret, 'ListarProdutos', {
      pagina: 1, registros_por_pagina: 5,
      filtrar_apenas_omiepdv: 'N',
      produto_servico_cadastro: [{ codigo: sku }]
    });
    const prods = lista.produto_servico_cadastro || [];
    return prods[0]?.codigo_produto ?? null;
  } catch(e) {
    console.error('[remessa] buscarNCodProd', sku, e.message);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { orig, data_previsao, itens } = req.body || {};
  if (!orig || !CONFIG[orig]) return res.status(400).json({ erro: 'orig deve ser Matriz ou Filial' });
  if (!itens || !itens.length) return res.status(400).json({ erro: 'itens é obrigatório' });

  const cfg = CONFIG[orig];

  // Buscar nCodProd de cada SKU no sistema de origem
  const semCodigo = [];
  const produtosResolvidos = [];
  for (const item of itens) {
    const nCodProd = await buscarNCodProd(item.sku, cfg);
    if (!nCodProd) {
      semCodigo.push(item.sku);
    } else {
      produtosResolvidos.push({ ...item, nCodProd });
    }
    await sleep(200);
  }

  if (!produtosResolvidos.length) {
    return res.status(400).json({
      erro: `Nenhum produto encontrado no sistema ${orig}. SKUs não encontrados: ${semCodigo.join(', ')}`
    });
  }

  const ts = new Date().toISOString().replace(/\D/g,'').slice(0,14);
  const cCodIntRem = ('REM' + orig.slice(0,1) + ts).slice(0, 30);

  const produtos = produtosResolvidos.map((item, i) => ({
    cCodItInt: (cCodIntRem + '-' + (i+1)).slice(0, 30),
    nCodIt:    0,
    nCodProd:  item.nCodProd,
    nQtde:     item.quantidade,
    nValUnit:  item.valor_unitario,
  }));

  const omiePayload = {
    call:       'IncluirRemessa',
    app_key:    cfg.app_key,
    app_secret: cfg.app_secret,
    param: [{
      cabec: {
        cCodIntRem,
        dPrevisao:  data_previsao,
        nCodCli:    cfg.nCodCli,
        nCodRem:    0,
        nCodVend:   ''
      },
      frete: {
        cTpFrete:   '9',
        nValFrete:  0,
        nValSeguro: 0,
        nValOutras: 0,
      },
      infAdic: {
        cCodCateg:  '1.01.03',
        cConsFinal: 'N',
        cContato:   '',
        cDadosAdic: '',
        cNumCtr:    '',
        cPedido:    '',
        nCodProj:   0,
      },
      obs: { cObs: '' },
      produtos,
    }]
  };

  try {
    const response = await fetch(OMIE_REM_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(omiePayload)
    });
    const data = await response.json();

    // Inclui aviso de SKUs não encontrados se houver
    if (semCodigo.length) {
      data._avisoSkus = `SKUs não encontrados em ${orig} (não incluídos): ${semCodigo.join(', ')}`;
    }
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ erro: e.message });
  }
}
