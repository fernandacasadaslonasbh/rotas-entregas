// Vercel Serverless Function — proxy para Omie ListarNFe (loja Online)
// Busca as NFs mais recentes e devolve junto com _campos_data para debug

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

    // Inclui debug: mostra os campos do 1º registro para identificar o campo de data
    const lista = data.nfCadastro || data.nfListar || [];
    const debug = lista.length > 0 ? {
      _total: data.nfTotalRegistros || data.nTotalRegistros || lista.length,
      _paginas: data.nfTotalPaginas || data.nTotalPaginas || 1,
      _campo_cabecalho: Object.keys(lista[0].cabecalho || lista[0].cCabecalho || lista[0] || {}).slice(0, 30),
      _amostra_datas: lista.slice(0, 5).map(nf => {
        const cab = nf.cabecalho || nf.cCabecalho || nf;
        return { dEmi: cab.dEmi, data_emissao: cab.data_emissao, dDtEmissao: cab.dDtEmissao, nNF: cab.nNF };
      })
    } : { _total: 0, _vazio: true };

    return res.status(200).json({ nfCadastro: lista, ...debug,
      nfTotalPaginas: data.nfTotalPaginas || data.nTotalPaginas || 1 });
  } catch(e) {
    return res.status(500).json({ erro: e.message });
  }
}
