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
    app_key:                  '3554224779105',
    app_secret:               '6466fbd2b0bbfebc37b597face75280c',
    nCodCli:                  10136107449,  // CASA DAS LONAS LTDA - FILIAL no sistema Matriz
    codigo_cenario_impostos:  10148831396,  // Nota de Transferência (Matriz/Viamão)
  },
  Filial: {
    app_key:                  '3557069109594',
    app_secret:               '59d446121fb05b3c3e72d76f180e8e93',
    nCodCli:                  10138027795,  // CASA DAS LONAS LTDA - MATRIZ no sistema Filial
    codigo_cenario_impostos:  10144606902,  // Nota de Transferência (Filial/Pedro II)
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

// Retorna { nCodProd, cfop }
// CFOP 5.409 (ST): recomendacoes_fiscais.id_cest preenchido
// CFOP 5.152 (Tributado): id_cest vazio
async function buscarProduto(sku, cfg) {
  try {
    const data = await omieCall(OMIE_PROD_URL, cfg.app_key, cfg.app_secret, 'ConsultarProduto', {
      codigo: sku,
      codigo_produto: 0,
      codigo_produto_integracao: ''
    });
    const nCodProd = data.codigo_produto;
    if (!nCodProd) return null;

    const rec   = data.recomendacoes_fiscais || {};
    const idCest = String(rec.id_cest || '').trim();
    const isST  = idCest !== '';
    const cfop  = isST ? '5.409' : '5.152';
    return { nCodProd, cfop };
  } catch(e) {
    console.error('[remessa] buscarProduto', sku, e.message);
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

  // Buscar nCodProd e CFOP de cada SKU no sistema de origem
  const semCodigo = [];
  const produtosResolvidos = [];
  for (const item of itens) {
    const prod = await buscarProduto(item.sku, cfg);
    if (!prod) {
      semCodigo.push(item.sku);
    } else {
      produtosResolvidos.push({ ...item, nCodProd: prod.nCodProd, cfop: prod.cfop });
    }
    await sleep(100);
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
    cCFOP:     item.cfop,  // 5409 se ST (tem CEST), 5152 se Tributado
  }));

  const omiePayload = {
    call:       'IncluirRemessa',
    app_key:    cfg.app_key,
    app_secret: cfg.app_secret,
    param: [{
      cabec: {
        cCodIntRem,
        dPrevisao:               data_previsao,
        nCodCli:                 cfg.nCodCli,
        nCodRem:                 0,
        nCodVend:                '',
        codigo_cenario_impostos: cfg.codigo_cenario_impostos,
      },
      frete: {
        cTpFrete:   '9',
        nValFrete:  0,
        nValSeguro: 0,
        nValOutras: 0,
      },
      infAdic: {
        cCodCateg:  '1.02.99',
        cConsFinal: 'N',
        cContato:   '',
        cDadosAdic: 'ICMS ST RECOLHIDO ANTERIORMENTE POR SUB.TRIB.CONF. ANEXO VII, PARTE II DO DECRET. 48.589 DE 22/03/2023 DO RICMS MG.\n-- --\nTransferência de mercadoria equiparada a uma operação tributada, nos termos do § 5o do art. 12 da Lei Complementar no 87/96 e da cláusula sexta do Convênio ICMS no 109/24.',
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
