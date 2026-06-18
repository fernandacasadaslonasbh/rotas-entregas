/**
 * Vercel Serverless Function — saldo físico do CD no Omie
 * ObterEstoqueProduto → listaEstoque[nIdlocal=CD].fisico
 */

export const maxDuration = 60;

const APP_KEY    = '5490393509601';
const APP_SECRET = '63b1bb40caba6f37c7814735bf637acd';
const URL_EST    = 'https://app.omie.com.br/api/v1/estoque/resumo/';
const ID_LOCAL   = 11264312395; // Local de Estoque Padrão (CD)

const hoje = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

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

    // Procura o local específico (CD); se não achar, usa o primeiro
    const local = lista.find(e => e.nIdlocal === ID_LOCAL) || lista[0];
    // Campo correto é "fisico"; nSaldo é alias
    const saldo = local.fisico ?? local.nSaldo ?? 0;
    return typeof saldo === 'number' ? saldo : parseFloat(saldo) || 0;
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
  const BATCH = 8;
  for (let i = 0; i < skus.length; i += BATCH) {
    await Promise.all(skus.slice(i, i + BATCH).map(async (sku) => {
      results[sku.toUpperCase()] = await getSaldo(sku);
    }));
  }

  return res.status(200).json(results);
}
