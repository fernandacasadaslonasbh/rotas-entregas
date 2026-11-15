/**
 * Vercel Serverless Function — último preço de compra por SKU (Omie)
 * Busca NF-e de entrada (compra) mais recente por SKU.
 * Tenta CD primeiro; se não encontrar, tenta Filial.
 * Estratégia: busca por intervalo de datas (últimos 2 anos) e filtra SKU nos itens.
 *
 * POST { skus: ["2004", "1234", ...] }
 * → { "2004": { preco: 15.85, data: "29/10/2025", fornecedor: "CARGA TEXTIL...", empresa: "CD" } | null }
 */

export const maxDuration = 60;

const CREDS = {
  CD:     { key: '5490393509601',  secret: '63b1bb40caba6f37c7814735bf637acd' },
  Filial: { key: '3557069109594',  secret: '59d446121fb05b3c3e72d76f180e8e93' }
};
const URL_NFE = 'https://app.omie.com.br/api/v1/produtos/nfe/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Palavras-chave que identificam a própria empresa (transferências internas a ignorar)
const EMPRESA_PROPRIA = ['CASA DAS LONAS', 'CASADASLONAS'];

function parseDateBR(s) {
  if (!s) return null;
  const [d, m, y] = s.split('/');
  if (!d || !m || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

function formatDateBR(dt) {
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

function isEmpresaPropria(nome = '') {
  const upper = nome.toUpperCase().replace(/\s+/g, '');
  return EMPRESA_PROPRIA.some(kw => upper.includes(kw.replace(/\s+/g, '')));
}

/**
 * Faz uma chamada ListarNFe paginada na empresa e retorna o array de NF-e.
 */
async function listarNFe(creds, pagina, dataDeBR, dataAteBR) {
  const r = await fetch(URL_NFE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ListarNFe',
      app_key: creds.key,
      app_secret: creds.secret,
      param: [{
        pagina,
        registros_por_pagina: 50,
        filtrar_por_tipo: 'E',
        filtrar_por_data_de: dataDeBR,
        filtrar_por_data_ate: dataAteBR,
        ordenar_por: 'DATA_EMISSAO',
        ordem_decrescente: 'S'
      }]
    })
  });
  const data = await r.json();
  if (data.faultstring) return { nfs: [], totalPaginas: 0, _fault: data.faultstring };
  const nfs = data.nfCadastro || data.NfCadastro || data.cadastros || [];
  const totalPaginas = data.total_de_paginas || (nfs.length > 0 ? 1 : 0);
  return { nfs, totalPaginas };
}

/**
 * Busca o SKU em uma NF-e, retornando o preço unitário se encontrar.
 */
function extrairPrecoDoSku(nf, sku) {
  const detalhes = nf.nfDetalhe || nf.det || nf.detalhe || [];
  for (const det of detalhes) {
    const prod = det.nfProduto || det.produto || det.prod || {};
    const codigo = String(prod.cCodigo || prod.codigo || prod.cProduto || '').toUpperCase().trim();
    if (codigo === sku) {
      const preco = parseFloat(prod.nValUnit || prod.valor_unitario || prod.vUnCom || 0) || null;
      return preco;
    }
  }
  return null;
}

/**
 * Busca última NF-e de entrada para o SKU na empresa indicada.
 * Varre até MAX_PAGINAS páginas (50 NF-e por página), da mais recente à mais antiga.
 */
async function buscarPrecoNaEmpresa(sku, empresa) {
  const creds = CREDS[empresa];
  const skuUp = sku.toUpperCase().trim();

  const hoje = new Date();
  const doisAnosAtras = new Date();
  doisAnosAtras.setFullYear(hoje.getFullYear() - 2);
  const dataAteBR = formatDateBR(hoje);
  const dataDeBR  = formatDateBR(doisAnosAtras);

  const MAX_PAGINAS = 4; // até 200 NF-e por empresa

  try {
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const { nfs, totalPaginas, _fault } = await listarNFe(creds, pagina, dataDeBR, dataAteBR);

      if (_fault) {
        console.error(`[ultimo_preco] ${empresa} p${pagina} fault: ${_fault}`);
        return null;
      }
      if (!nfs.length) return null;

      for (const nf of nfs) {
        // Ignora NF-e internas (transferência entre unidades)
        const remetente = nf.nfRemetente || nf.remetente || nf.emit || {};
        const fornecedor = remetente.cRazaoSocial || remetente.razao_social || remetente.xNome || '';
        if (isEmpresaPropria(fornecedor)) continue;

        const preco = extrairPrecoDoSku(nf, skuUp);
        if (!preco) continue;

        const cab = nf.nfCabecalho || nf.cabecalho || {};
        const dataEmissao = cab.dEmi || cab.data_emissao || '';
        return { preco, data: dataEmissao, fornecedor, empresa };
      }

      // Se não há mais páginas, para
      if (pagina >= totalPaginas) break;

      await sleep(300);
    }

    return null;
  } catch (e) {
    console.error(`[ultimo_preco] ${empresa} ${sku}: ${e.message}`);
    return null;
  }
}

/**
 * Modo debug: retorna a resposta bruta da primeira página para inspecionar a estrutura.
 * POST { debug_raw: true, empresa: "CD" }
 */
async function debugRaw(empresa, dataDeBR, dataAteBR) {
  const creds = CREDS[empresa];
  const r = await fetch(URL_NFE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ListarNFe',
      app_key: creds.key,
      app_secret: creds.secret,
      param: [{
        pagina: 1,
        registros_por_pagina: 3,
        filtrar_por_tipo: 'E',
        filtrar_por_data_de: dataDeBR,
        filtrar_por_data_ate: dataAteBR,
        ordenar_por: 'DATA_EMISSAO',
        ordem_decrescente: 'S'
      }]
    })
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { skus, debug_raw, empresa: empDebug = 'CD' } = req.body || {};

  // ── Modo debug: inspecionar estrutura real da resposta ──
  if (debug_raw) {
    const hoje = new Date();
    const tresAtras = new Date(); tresAtras.setMonth(hoje.getMonth() - 3);
    const raw = await debugRaw(empDebug, formatDateBR(tresAtras), formatDateBR(hoje));
    // Retorna estrutura resumida: chaves do root + primeira NF parcial
    const nfs = raw.nfCadastro || raw.NfCadastro || raw.cadastros || raw.listaNfe || [];
    const primeiraNF = nfs[0] || null;
    return res.status(200).json({
      _debug: true,
      empresa: empDebug,
      root_keys: Object.keys(raw),
      total_registros: raw.total_de_registros,
      total_paginas: raw.total_de_paginas,
      faultstring: raw.faultstring || null,
      nfs_array_name: raw.nfCadastro ? 'nfCadastro' : raw.NfCadastro ? 'NfCadastro' : raw.cadastros ? 'cadastros' : raw.listaNfe ? 'listaNfe' : 'NÃO ENCONTRADO',
      nfs_count: nfs.length,
      primeira_nf_keys: primeiraNF ? Object.keys(primeiraNF) : [],
      primeira_nf_cabecalho: primeiraNF?.nfCabecalho || primeiraNF?.cabecalho || null,
      primeira_nf_remetente: primeiraNF?.nfRemetente || primeiraNF?.remetente || primeiraNF?.emit || null,
      primeira_nf_detalhe_0_keys: primeiraNF ? Object.keys((primeiraNF.nfDetalhe||primeiraNF.det||primeiraNF.detalhe||[])[0]||{}) : [],
      primeira_nf_produto_0: (() => {
        if (!primeiraNF) return null;
        const det = (primeiraNF.nfDetalhe||primeiraNF.det||primeiraNF.detalhe||[])[0]||{};
        return det.nfProduto || det.produto || det.prod || null;
      })()
    });
  }

  if (!skus || !skus.length) return res.status(400).json({ erro: 'skus é obrigatório' });

  const results = {};

  for (const sku of skus) {
    const skuUp = sku.toUpperCase().trim();

    // 1. Tenta CD
    let resultado = await buscarPrecoNaEmpresa(sku, 'CD');
    await sleep(300);

    // 2. Se não achou no CD, tenta Filial
    if (!resultado) {
      resultado = await buscarPrecoNaEmpresa(sku, 'Filial');
      await sleep(300);
    }

    results[skuUp] = resultado ?? null;
  }

  return res.status(200).json(results);
}
