// Vercel Serverless Function — proxy para Omie ListarNFe
// VERSÃO DEBUG COMPLETO — retorna resposta bruta + tenta variações de parâmetros

export const maxDuration = 60;

// Credenciais Omie ERP principal (CD) — mesmas do estoque.js
const APP_KEY    = '5490393509601';
const APP_SECRET = '63b1bb40caba6f37c7814735bf637acd';
const OMIE_URL   = 'https://app.omie.com.br/api/v1/produtos/nfe/';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  try {
    // Tentativa 1: sem filtros (como antes)
    const r1 = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarNFe',
        app_key: APP_KEY, app_secret: APP_SECRET,
        param: [{ nPagina: 1, nRegPorPagina: 50 }]
      })
    });
    const d1 = await r1.json();

    // Tentativa 2: com cSituacao = "A" (autorizadas)
    const r2 = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarNFe',
        app_key: APP_KEY, app_secret: APP_SECRET,
        param: [{ nPagina: 1, nRegPorPagina: 50, cSituacao: 'A' }]
      })
    });
    const d2 = await r2.json();

    // Tentativa 3: com dEmissaoInicial / dEmissaoFinal
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }); // DD/MM/YYYY
    const r3 = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarNFe',
        app_key: APP_KEY, app_secret: APP_SECRET,
        param: [{ nPagina: 1, nRegPorPagina: 50, dEmissaoInicial: '01/01/2025', dEmissaoFinal: hoje }]
      })
    });
    const d3 = await r3.json();

    const resumo = (label, d) => ({
      label,
      faultstring: d.faultstring || null,
      erro: d.erro || null,
      campos_raiz: Object.keys(d),
      nTotRegistros: d.nTotRegistros ?? d.nRegistros ?? '?',
      nTotPaginas:   d.nTotPaginas  ?? '?',
      listagemNfe_len: Array.isArray(d.listagemNfe) ? d.listagemNfe.length : 'não é array',
      raw_parcial: JSON.stringify(d).slice(0, 400)
    });

    return res.status(200).json({
      _debug: true,
      _t1_sem_filtro: resumo('Sem filtro', d1),
      _t2_cSituacao_A: resumo('cSituacao=A', d2),
      _t3_data_range: resumo('dEmissaoInicial..Final', d3)
    });

  } catch(e) {
    return res.status(500).json({ erro: e.message });
  }
}
