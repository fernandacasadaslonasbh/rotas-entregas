/**
 * Vercel Serverless Function — saldo físico no Omie
 * Chamadas SEQUENCIAIS com delay para evitar rate limit do Omie
 */

export const maxDuration = 60;

const APP_KEY  = '5490393509601';
const APP_SECRET = '63b1bb40caba6f37c7814735bf637acd';
const URL_EST  = 'https://app.omie.com.br/api/v1/estoque/resumo/';

const hoje = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getSaldo(sku) {
  try {
    const r = await fetch(URL_EST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ObterEstoqueProduto',
        app_key: APP_KEY,
        app_secret: APP_SECRET,
        param: [{ cEAN: '', nIdProduto: 0, cCodigo: String(sku), xCodigo: '', dDia: hoje() }]
      })
    });
    const data = await r.json();
    if (data.faultstring) return null;
    const lista = data.listaEstoque || [];
    if (!lista.length) return 0;
    // Soma todos os locais — igual ao "Estoque Físico" no Omie
    return lista.reduce((sum, e) => sum + (parseFloat(e.fisico ?? e.nSaldo ?? 0) || 0), 0);
  } catch (e) {
    console.error(`[estoque] ${sku}: ${e.message}`);
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
    results[sku.toUpperCase()] = await getSaldo(sku);
    await sleep(300); // 300ms entre cada chamada — igual ao script Python
  }

  return res.status(200).json(results);
}
