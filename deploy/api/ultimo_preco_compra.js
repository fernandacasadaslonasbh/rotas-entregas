/**
 * Vercel Serverless Function — último preço de compra por SKU (Omie)
 * Busca NF-e de entrada (compra) mais recente por SKU.
 * Tenta CD primeiro; se não encontrar, tenta Filial.
 *
 * POST { skus: ["2004", "1234", ...], debug?: false }
 * → { "2004": { preco: 15.85, data: "29/10/2025", fornecedor: "CARGA TEXTIL...", empresa: "CD" } | null }
 */

export const maxDuration = 60;

const CREDS = {
  CD:     { key: '5490393509601',  secret: '63b1bb40caba6f37c7814735bf637acd' },
  Filial: { key: '3557069109594',  secret: '59d446121fb05b3c3e72d76f180e8e93' }
};
const URL_NFE = 'https://app.omie.com.br/api/v1/produtos/nfe/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Palavras-chave que identificam a própria empresa (transferências internas)
// NF-e cujo remetente contenha qualquer um desses termos é ignorada
const EMPRESA_PROPRIA = ['CASA DAS LONAS', 'CASADASLONAS'];

/**
 * Converte data "DD/MM/YYYY" para Date para comparação.
 */
function parseDateBR(s) {
  if (!s) return null;
  const [d, m, y] = s.split('/');
  if (!d || !m || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

/** Verifica se o remetente é a própria empresa (transferência interna) */
function isEmpresaPropria(nome = '') {
  const upper = nome.toUpperCase().replace(/\s+/g, '');
  return EMPRESA_PROPRIA.some(kw => upper.includes(kw.replace(/\s+/g, '')));
}

/**
 * Busca última NF-e de entrada para o SKU na empresa indicada.
 * Ignora NF-e cujo remetente seja a própria Casa das Lonas.
 * Retorna { preco, data, fornecedor, empresa } ou null.
 */
async function buscarPrecoNaEmpresa(sku, empresa, debug = false) {
  const creds = CREDS[empresa];
  try {
    const body = {
      call: 'ListarNFe',
      app_key: creds.key,
      app_secret: creds.secret,
      param: [{
        pagina: 1,
        registros_por_pagina: 20,
        apenas_importado_api: 'N',
        filtrar_por_tipo: 'E',
        filtrar_por_codigo_produto: String(sku),
        ordenar_por: 'DATA_EMISSAO',
        ordem_decrescente: 'S'
      }]
    };

    const r = await fetch(URL_NFE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();

    if (debug) {
      console.log(`[ultimo_preco] ${empresa} ${sku} raw:`, JSON.stringify(data).slice(0, 500));
    }

    if (data.faultstring) return null;

    // A resposta do ListarNFe contém array em diferentes nomes dependendo da versão
    const nfs = data.nfCadastro || data.NfCadastro || data.cadastros || [];
    if (!nfs.length) return null;

    // Pega a mais recente (já ordenada DESC pelo Omie)
    let melhorPreco = null;
    let melhorData = null;

    for (const nf of nfs) {
      // Verifica o remetente da NF inteira (transferência interna = ignorar)
      const remetente = nf.nfRemetente || nf.remetente || nf.emit || {};
      const fornecedor = remetente.cRazaoSocial || remetente.razao_social || remetente.xNome || '';
      if (isEmpresaPropria(fornecedor)) continue; // Pula NF-e interna

      const cab = nf.nfCabecalho || nf.cabecalho || {};
      const dataEmissao = cab.dEmi || cab.data_emissao || '';
      const dtObj = parseDateBR(dataEmissao);

      // Busca o item com o SKU nos detalhes da NF
      const detalhes = nf.nfDetalhe || nf.det || nf.detalhe || [];
      for (const det of detalhes) {
        const prod = det.nfProduto || det.produto || det.prod || {};
        const codigo = String(prod.cCodigo || prod.codigo || prod.cProduto || '').toUpperCase();
        if (codigo !== sku.toUpperCase()) continue;

        const preco = parseFloat(prod.nValUnit || prod.valor_unitario || prod.vUnCom || 0) || null;
        if (!preco) continue;

        if (!melhorData || (dtObj && dtObj > melhorData)) {
          melhorData = dtObj;
          melhorPreco = { preco, data: dataEmissao, fornecedor, empresa };
        }
        break; // Já encontrou o SKU nessa NF, passa para próxima
      }

      if (melhorPreco) break; // Já tem a mais recente externa, para
    }

    return melhorPreco;

  } catch (e) {
    console.error(`[ultimo_preco] ${empresa} ${sku}: ${e.message}`);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { skus, debug = false } = req.body || {};
  if (!skus || !skus.length) return res.status(400).json({ erro: 'skus é obrigatório' });

  const results = {};

  for (const sku of skus) {
    const skuUp = sku.toUpperCase();

    // 1. Tenta CD
    let resultado = await buscarPrecoNaEmpresa(sku, 'CD', debug);
    await sleep(350);

    // 2. Se não encontrou no CD, tenta Filial
    if (!resultado) {
      resultado = await buscarPrecoNaEmpresa(sku, 'Filial', debug);
      await sleep(350);
    }

    results[skuUp] = resultado; // null se não encontrou em nenhuma
  }

  return res.status(200).json(results);
}
