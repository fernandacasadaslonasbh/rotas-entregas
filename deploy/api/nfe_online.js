// Vercel Serverless Function — proxy para Omie ListarNFe (loja Online)
// VERSÃO DEBUG: retorna resposta bruta da Omie para identificar campos corretos

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

  const { pagina = 1 } = req.body || {};

  try {
    const resp = await fetch(OMIE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        call: 'ListarNFe',
        app_key:    APP_KEY,
        app_secret: APP_SECRET,
        param: [{ nPagina: pagina, nRegPorPagina: 50 }]
      })
    });
    const data = await resp.json();

    if (data.faultstring) throw new Error(data.faultstring);

    // Retorna resposta bruta + metadados de debug:
    // _campos_raiz = todos os campos no nível raiz da resposta
    // _amostra = os primeiros campos do primeiro registro (qualquer chave de array)
    const camposRaiz = Object.keys(data);
    const primeiroArray = camposRaiz.find(k => Array.isArray(data[k]));
    const amostraItem = primeiroArray && data[primeiroArray].length > 0
      ? { _chaveArray: primeiroArray, _camposItem: Object.keys(data[primeiroArray][0]), _item0: data[primeiroArray][0] }
      : { _chaveArray: null };

    return res.status(200).json({
      _debug: true,
      _campos_raiz: camposRaiz,
      _total_raiz: camposRaiz.map(k => ({ campo: k, tipo: Array.isArray(data[k]) ? `array(${data[k].length})` : typeof data[k], valor: Array.isArray(data[k]) ? data[k].length : data[k] })),
      _amostra: amostraItem,
      _raw: data   // resposta completa da Omie
    });
  } catch(e) {
    return res.status(500).json({ erro: e.message });
  }
}
