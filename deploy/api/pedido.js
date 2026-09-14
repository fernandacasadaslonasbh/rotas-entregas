// Vercel Serverless Function — proxy para Omie IncluirPedido
// Roda no servidor Vercel, sem precisar de servidor local
// Aceita codigo_cliente (numérico) OU cnpj_cliente (string CNPJ limpo)

export const maxDuration = 60;

const APP_KEY_CD    = '5490393509601';
const APP_SECRET_CD = '63b1bb40caba6f37c7814735bf637acd';
const OMIE_URL      = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_CLI_URL  = 'https://app.omie.com.br/api/v1/geral/clientes/';

// Resolve CNPJ → nCodCliente via Omie
async function resolverCnpj(cnpj) {
  const r = await fetch(OMIE_CLI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarCliente',
      app_key: APP_KEY_CD,
      app_secret: APP_SECRET_CD,
      param: [{ cnpj_cpf: cnpj }]
    })
  });
  const data = await r.json();
  if (data.faultstring) throw new Error('Omie: ' + data.faultstring);
  const cod = data.nCodCliente || data.codigo_cliente;
  if (!cod) throw new Error('Cliente não encontrado para CNPJ ' + cnpj);
  return Number(cod);
}

export default async function handler(req, res) {
  // CORS — permite chamadas do app hospedado no Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  let { codigo_cliente, cnpj_cliente, data_previsao, itens, prefixo } = req.body || {};
  if (!itens || !itens.length) {
    return res.status(400).json({ erro: 'itens são obrigatórios' });
  }

  // Resolve cliente por CNPJ se codigo_cliente não fornecido
  if (!codigo_cliente && cnpj_cliente) {
    try {
      const cnpjLimpo = String(cnpj_cliente).replace(/\D/g, '');
      codigo_cliente = await resolverCnpj(cnpjLimpo);
    } catch(e) {
      return res.status(400).json({ erro: e.message });
    }
  }
  if (!codigo_cliente) {
    return res.status(400).json({ erro: 'codigo_cliente ou cnpj_cliente são obrigatórios' });
  }

  const ts = new Date().toISOString().replace(/\D/g,'').slice(0,14);
  const pref = (prefixo || 'ROTA').toUpperCase().slice(0, 4);
  const integracaoId = (pref + ts).slice(0, 30);

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
        codigo_categoria:      '1.01.03',
        codigo_conta_corrente: 11268933607,
        consumidor_final:      'N',
        enviar_email:          'N',
        dados_adicionais_nf:   'DOCUMENTO FISCAL EMITIDO NOS TERMOS DO REGIME ESPECIAL e-PTA-RE nº 45.000043720-93'
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
