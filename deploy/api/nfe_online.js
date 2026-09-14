// Vercel Serverless Function — proxy para Omie ListarNFe (loja Online)
// Usado pela aba "Gerar Difal" do relatório e-commerce

export const maxDuration = 60;

const APP_KEY    = '7167467499192';
const APP_SECRET = '4e3e8e18fbefee789318d4e63108c9c1';
const OMIE_URL   = 'https://app.omie.com.br/api/v1/produtos/nfe/';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  let { data_de, data_ate, pagina } = req.body || {};
  if (!data_de) return res.status(400).json({ erro: 'data_de é obrigatório (DD/MM/YYYY)' });
  if (!data_ate) data_ate = data_de;
  if (!pagina) pagina = 1;

  const omiePayload = {
    call: 'ListarNFe',
    app_key: APP_KEY,
    app_secret: APP_SECRET,
    param: [{
      pagina,
      registros_por_pagina: 50,
      filtrar_por_data_de:  data_de,
      filtrar_por_data_ate: data_ate
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
