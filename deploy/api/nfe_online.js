// Vercel Serverless Function — proxy para Omie ListarNFe (loja Online)
// Busca NFs por data com filtragem server-side (a Omie não aceita filtro por data nessa chamada)

export const maxDuration = 60;

const APP_KEY    = '7167467499192';
const APP_SECRET = '4e3e8e18fbefee789318d4e63108c9c1';
const OMIE_URL   = 'https://app.omie.com.br/api/v1/produtos/nfe/';

// Busca uma página de NFs sem filtro de data e retorna {nfCadastro, nTotalPaginas}
async function listarPagina(pagina) {
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
  return await resp.json();
}

// Normaliza data de emissão vinda da Omie (vários formatos possíveis) → DD/MM/YYYY
function normDate(d) {
  if (!d) return '';
  // DD/MM/YYYY HH:MM:SS  ou  DD/MM/YYYY
  const m = d.match(/^(\d{2}\/\d{2}\/\d{4})/);
  if (m) return m[1];
  // YYYY-MM-DD
  const m2 = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[3]}/${m2[2]}/${m2[1]}`;
  return d;
}

// Extrai data de emissão de um registro NF (tenta vários caminhos conhecidos)
function getDataEmissao(nf) {
  const cab = nf.cabecalho || nf.cCabecalho || {};
  return normDate(cab.dEmi || cab.data_emissao || cab.dDtEmissao || '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  let { data_de, pagina } = req.body || {};
  if (!data_de) return res.status(400).json({ erro: 'data_de é obrigatório (DD/MM/YYYY)' });
  if (!pagina) pagina = 1;

  try {
    // Primeira chamada — descobre total de páginas
    const primeira = await listarPagina(pagina);
    if (primeira.faultstring) throw new Error(primeira.faultstring);

    const lista = primeira.nfCadastro || primeira.nfListar || [];
    const totalPaginas = primeira.nfTotalPaginas || primeira.nTotalPaginas || 1;

    // Se paginado pelo cliente (pagina > 1), retorna raw sem filtro de data
    // Se pagina == 1, faz filtragem server-side: busca todas as páginas e filtra pela data
    let todas = [...lista];
    if (pagina === 1) {
      for (let p = 2; p <= Math.min(totalPaginas, 20); p++) {
        const r = await listarPagina(p);
        const itens = r.nfCadastro || r.nfListar || [];
        todas = todas.concat(itens);
        // Otimização: se todas as NFs desta página são mais antigas que data_de, para
        // (assume que a Omie devolve ordenado do mais recente para o mais antigo)
        if (itens.length > 0) {
          const dataUltima = getDataEmissao(itens[itens.length - 1]);
          // converte DD/MM/YYYY para comparação
          const toISO = d => d ? d.split('/').reverse().join('-') : '0000-00-00';
          if (toISO(dataUltima) < toISO(data_de)) break;
        }
      }
      // Filtra só as NFs da data pedida
      const filtradas = todas.filter(nf => getDataEmissao(nf) === data_de);
      return res.status(200).json({
        nfCadastro: filtradas,
        nfTotalPaginas: 1,
        nTotalRegistros: filtradas.length
      });
    }

    return res.status(200).json(primeira);
  } catch(e) {
    return res.status(500).json({ erro: e.message });
  }
}
