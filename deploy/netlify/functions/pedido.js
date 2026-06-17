// Netlify Function — proxy para Omie IncluirPedido
// Roda no servidor Netlify, sem precisar de servidor local

const APP_KEY_CD    = '5490393509601';
const APP_SECRET_CD = '63b1bb40caba6f37c7814735bf637acd';
const OMIE_URL      = 'https://app.omie.com.br/api/v1/produtos/pedido/';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erro: 'Método não permitido' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ erro: 'Payload inválido' }) }; }

  const { codigo_cliente, data_previsao, itens } = payload;
  if (!codigo_cliente || !itens || !itens.length) {
    return { statusCode: 400, body: JSON.stringify({ erro: 'codigo_cliente e itens são obrigatórios' }) };
  }

  const ts = new Date().toISOString().replace(/\D/g,'').slice(0,14);
  const integracaoId = ('ROTA' + ts).slice(0, 30);

  const det = itens.map((item, i) => ({
    ide: { codigo_item_integracao: (integracaoId + '-' + (i+1)).slice(0, 30) },
    produto: {
      codigo_produto: item.codigo_produto,
      quantidade:     item.quantidade,
      valor_unitario: item.valor_unitario,
      valor_desconto: 0,
      tipo_desconto:  'P'
    },
    inf_adic: {
      codigo_local_estoque:         11264312395,
      codigo_categoria_item:        '1.01.03',
      codigo_cenario_impostos_item: '11596919404'
    }
  }));

  const omiePayload = {
    call:       'IncluirPedido',
    app_key:    APP_KEY_CD,
    app_secret: APP_SECRET_CD,
    param: [{
      cabecalho: {
        codigo_pedido_integracao: integracaoId,
        codigo_cliente:           codigo_cliente,
        data_previsao:            data_previsao,
        etapa:                    '10',
        codigo_parcela:           '000',
        codigo_cenario_impostos:  '11596919404'
      },
      frete: { modalidade: '9' },
      informacoes_adicionais: {
        codigo_categoria:    '1.01.03',
        codigo_conta_corrente: 11268933607,
        consumidor_final:    'N',
        enviar_email:        'N',
        dados_adicionais_nf: 'DOCUMENTO FISCAL EMITIDO NOS TERMOS DO REGIME ESPECIAL e-PTA-RE nº 45.000043720-93'
      },
      det
    }]
  };

  try {
    const res  = await fetch(OMIE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(omiePayload)
    });
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ erro: e.message })
    };
  }
};
