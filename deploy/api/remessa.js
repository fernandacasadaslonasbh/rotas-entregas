/**
 * Vercel Serverless Function — proxy para Omie IncluirRemessa (Matriz↔Filial)
 * POST { orig: "Matriz"|"Filial", data_previsao: "DD/MM/YYYY", itens: [{codigo_produto, quantidade, valor_unitario}] }
 */

export const maxDuration = 60;

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/remessa/';

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
  const ts = new Date().toISOString().replace(/\D/g,'').slice(0,14);
  const cCodIntRem = ('REM' + orig.slice(0,1) + ts).slice(0, 30);

  const produtos = itens.map((item, i) => ({
    cCodItInt: (cCodIntRem + '-' + (i+1)).slice(0, 30),
    nCodIt:    0,
    nCodProd:  item.codigo_produto,
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
    const response = await fetch(OMIE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(omiePayload)
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ erro: e.message });
  }
}
