/**
 * Vercel Serverless Function — saldo DISPONÍVEL no Omie (Matriz / Filial)
 * Exclusivo para o app Transferências/Compras
 * Usa nSaldo (físico − reservado) em vez de fisico total
 */

export const maxDuration = 60;

const CREDS = {
  Matriz: { key: '3554224779105', secret: '6466fbd2b0bbfebc37b597face75280c' },
  Filial: { key: '3557069109594', secret: '59d446121fb05b3c3e72d76f180e8e93' }
};
const URL_EST = 'https://app.omie.com.br/api/v1/estoque/resumo/';

const hoje = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getSaldo(sku, creds) {
  try {
    const r = await fetch(URL_EST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ObterEstoqueProduto',
        app_key: creds.key,
        app_secret: creds.secret,
        param: [{ cEAN: '', nIdProduto: 0, cCodigo: String(sku), xCodigo: '', dDia: hoje() }]
      })
    });
    const data = await r.json();
    if (data.faultstring) return null;
    const lista = data.listaEstoque || [];
    if (!lista.length) return { fisico: 0, cmc: null };
    // nSaldo = disponível (físico − reservado)
    const fisico = lista.reduce((sum, e) => sum + (parseFloat(e.nSaldo ?? e.fisico ?? 0) || 0), 0);
    const cmc = parseFloat(lista[0]?.nCMC) || null;
    return { fisico, cmc };
  } catch (e) {
    console.error(`[estoque_loja_tc] ${sku}: ${e.message}`);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { loja, skus } = req.body || {};
  if (!loja || !CREDS[loja]) return res.status(400).json({ erro: 'loja deve ser Matriz ou Filial' });
  if (!skus || !skus.length) return res.status(400).json({ erro: 'skus é obrigatório' });

  const creds = CREDS[loja];
  const results = {};
  for (const sku of skus) {
    results[sku.toUpperCase()] = await getSaldo(sku, creds);
    await sleep(300);
  }

  return res.status(200).json(results);
}
