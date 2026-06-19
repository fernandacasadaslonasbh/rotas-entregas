/**
 * Vercel Serverless Function — proxy para Omie IncluirPedido (remessa Matriz↔Filial)
 * POST { orig: "Matriz"|"Filial", data_previsao: "DD/MM/YYYY", itens: [{codigo_produto, quantidade, valor_unitario}] }
 */

export const maxDuration = 60;

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

const CONFIG = {
  Matriz: {
    app_key:                '3554224779105',
    app_secret:             '6466fbd2b0bbfebc37b597face75280c',
    codigo_cliente:         10136107449,   // CASA DAS LONAS LTDA - FILIAL no sistema Matriz
    codigo_cenario_impostos:'10132725928',
    codigo_conta_corrente:  10121408233,
    codigo_local_estoque:   10117384851,
  },
  Filial: {
    app_key:                '3557069109594',
    app_secret:             '59d446121fb05b3c3e72d76f180e8e93',
    codigo_cliente:         10138027795,   // CASA DAS LONAS LTDA - MATRIZ no sistema Filial
    codigo_cenario_impostos:'10117820156',
    codigo_conta_corrente:  10131382838,
    codigo_local_estoque:   10117488265,
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
  const integracaoId = ('REM' + orig.slice(0,1) + ts).slice(0, 30);

  const det = itens.map((item, i) => ({
    ide: { codigo_item_integracao: (integracaoId + '-' + (i+1)).slice(0, 30) },
    produto: {
      codigo_produto: item.codigo_produto,
      quantidade:     item.quantidade,
      valor_unitario: item.valor_unitario,
      valor_desconto: 0,
      tipo_desconto:  'P',
      cfop:           '5.405'
    },
    inf_adic: {
      codigo_local_estoque:         cfg.codigo_local_estoque,
      codigo_categoria_item:        '1.01.03',
      codigo_cenario_impostos_item: cfg.codigo_cenario_impostos
    }
  }));

  const omiePayload = {
    call:       'IncluirPedido',
    app_key:    cfg.app_key,
    app_secret: cfg.app_secret,
    param: [{
      cabecalho: {
        codigo_pedido_integracao: integracaoId,
        codigo_cliente:           cfg.codigo_cliente,
        data_previsao:            data_previsao,
        etapa:                    '10',
        codigo_parcela:           '000',
        codigo_cenario_impostos:  cfg.codigo_cenario_impostos
      },
      frete: { modalidade: '9' },
      informacoes_adicionais: {
        codigo_categoria:      '1.01.03',
        codigo_conta_corrente: cfg.codigo_conta_corrente,
        consumidor_final:      'N',
        enviar_email:          'N'
      },
      det
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
