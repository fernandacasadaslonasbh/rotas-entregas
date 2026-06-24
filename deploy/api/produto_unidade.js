/**
 * Vercel Serverless Function — unidade de medida dos produtos no Omie
 * Exclusivo para o app Transferências/Compras
 * Consulta o cadastro do produto e retorna o campo unidade
 */

export const maxDuration = 60;

const APP_KEY    = '5490393509601';
const APP_SECRET = '63b1bb40caba6f37c7814735bf637acd';
const URL_PROD   = 'https://app.omie.com.br/api/v1/geral/produtos/';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getUnidade(sku) {
  try {
    const r = await fetch(URL_PROD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ConsultarProduto',
        app_key: APP_KEY,
        app_secret: APP_SECRET,
        param: [{ codigo: String(sku) }]
      })
    });
    const data = await r.json();
    if (data.faultstring) return null;
    return data.unidade || null;
  } catch (e) {
    console.error(`[produto_unidade] ${sku}: ${e.message}`);
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
    results[sku.toUpperCase()] = await getUnidade(sku);
    await sleep(300);
  }

  return res.status(200).json(results);
}
