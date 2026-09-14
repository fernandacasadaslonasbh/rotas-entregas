// Vercel Serverless Function — proxy para Omie ListarNFe (ERP principal CD)
// Busca NFs emitidas no Omie ERP (não na loja online) e filtra por data no servidor

export const maxDuration = 60;

const APP_KEY    = '5490393509601';
const APP_SECRET = '63b1bb40caba6f37c7814735bf637acd';
const OMIE_URL   = 'https://app.omie.com.br/api/v1/produtos/nfe/';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { pagina = 1, data_de = null, data_ate = null } = req.body || {};

  try {
    // Parâmetros básicos — só paginação (sem filtro de data até sabermos os nomes corretos)
    const param = { nPagina: pagina, nRegPorPagina: 50 };

    const resp = await fetch(OMIE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        call: 'ListarNFe',
        app_key:    APP_KEY,
        app_secret: APP_SECRET,
        param: [param]
      })
    });
    const data = await resp.json();

    if (data.faultstring) throw new Error(data.faultstring);

    // Campo correto descoberto pelo debug anterior: listagemNfe
    const lista = data.listagemNfe || data.nfCadastro || data.nfListar || [];
    const total = data.nTotRegistros || data.nfTotalRegistros || 0;
    const totalPags = data.nTotPaginas || data.nfTotalPaginas || 1;

    // Debug: mostra campos do 1º item para sabermos o formato de data
    const debug = lista.length > 0 ? {
      _campos_cabecalho: Object.keys(lista[0].cabecalho || lista[0].cCabecalho || lista[0] || {}).slice(0, 40),
      _campos_dest:      Object.keys(lista[0].destinatario || lista[0].dest || lista[0].cDest || {}),
      _campos_total:     Object.keys(lista[0].total || lista[0].totalNF || {}),
      _amostra: lista.slice(0, 3).map(nf => {
        const cab = nf.cabecalho || nf.cCabecalho || nf;
        return { nNF: cab.nNF, dEmi: cab.dEmi, dDtEmissao: cab.dDtEmissao, data_emissao: cab.data_emissao };
      })
    } : { _vazio: true, _nota: 'Nenhuma NF retornada pela Omie' };

    return res.status(200).json({
      nfCadastro: lista,
      nfTotalPaginas: totalPags,
      nTotRegistros: total,
      ...debug
    });

  } catch(e) {
    return res.status(500).json({ erro: e.message });
  }
}
