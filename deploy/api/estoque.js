/**
 * Vercel Serverless Function — saldo físico do CD no Omie
 * Usa ObterEstoqueProduto (estoque/resumo) → campo nSaldoFisico por localEstoque
 */

export const maxDuration = 60;

const APP_KEY    = '5490393509601';
const APP_SECRET = '63b1bb40caba6f37c7814735bf637acd';
const URL_EST    = 'https://app.omie.com.br/api/v1/estoque/resumo/';
const COD_LOCAL  = 11264312395; // CD

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

    if (data.faultstring) {
      console.log(`[estoque] SKU ${sku} fault: ${data.faultstring}`);
      return null;
    }

    const lista = data.listaEstoque || [];
    if (!lista.length) {
      console.log(`[estoque] SKU ${sku}: listaEstoque vazia. Keys: ${Object.keys(data).join(',')}`);
      return 0;
    }

    // Log do primeiro item para debug
    console.log(`[estoque] SKU ${sku} primeiro item keys: ${Object.keys(lista[0]).join(',')}`);

    // Tenta localizar o CD específico; se não achar, usa primeiro da lista
    const local = lista.find(e => e.nCodLocalEstoque === COD_LOCAL) || lista[0];

    // Tenta os possíveis nomes do campo de saldo físico no Omie
    const saldo = local.nSaldoFisico ?? local.nSaldo ?? local.saldo_fisico ?? local.nEstoque ?? 0;
    return typeof saldo === 'number' ? saldo : parseFloat(saldo) || 0;
  } catch (e) {
    console.error(`[estoque] SKU ${sku} erro: ${e.message}`);
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
