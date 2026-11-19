/**
 * Vercel Serverless Function — preço unitário de VENDA do cadastro do produto no Omie
 * Exclusivo para o app Precificação
 * Consulta o cadastro (ConsultarProduto → valor_unitario). O preço é igual em todas as lojas:
 * consulta a Matriz e, só se não achar o produto lá, tenta Filial e depois CD.
 *
 * POST { skus: ["2512", "3127", ...] }
 * → { "2512": { valor: 6.5, empresa: "matriz" }, "9999": null }
 */

export const maxDuration = 60;

const CREDS = {
  matriz: { key: '3554224779105', secret: '6466fbd2b0bbfebc37b597face75280c' },
  filial: { key: '3557069109594', secret: '59d446121fb05b3c3e72d76f180e8e93' },
  cd:     { key: '5490393509601', secret: '63b1bb40caba6f37c7814735bf637acd' }
};
const URL_PROD = 'https://app.omie.com.br/api/v1/geral/produtos/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPreco(sku, creds) {
  try {
    const r = await fetch(URL_PROD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ConsultarProduto',
        app_key: creds.key,
        app_secret: creds.secret,
        param: [{ codigo: String(sku) }]
      })
    });
    const data = await r.json();
    if (data.faultstring) return null;
    const v = parseFloat(data.valor_unitario);
    return isNaN(v) ? null : v;
  } catch (e) {
    console.error(`[preco_venda] ${sku}: ${e.message}`);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { skus } = req.body || {};
  if (!skus || !skus.length) return res.status(400).json({ erro: 'skus é obrigatório' });

  const results = {};
  for (const sku of skus) {
    let achou = null;
    for (const empresa of ['matriz', 'filial', 'cd']) {
      const valor = await getPreco(sku, CREDS[empresa]);
      if (valor != null) { achou = { valor, empresa }; break; }
    }
    results[String(sku).toUpperCase()] = achou;
    await sleep(300);
  }

  return res.status(200).json(results);
}
