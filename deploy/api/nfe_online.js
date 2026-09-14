/**
 * Vercel Serverless Function — NFs com DIFAL/FCP (Omie Online)
 * POST { data: "YYYY-MM-DD", pagina: 1 }
 *
 * Usa ListarPedidos na conta Omie Online.
 * DIFAL e FCP ficam nos itens do pedido: det[i].imposto.icms_ie
 * Número/chave da NF ficam em infoCadastro.
 */

export const maxDuration = 60;

const KEY = '7167467499192';
const SEC = '4e3e8e18fbefee789318d4e63108c9c1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listarPedidos(dataBR, pagina) {
  const r = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ListarPedidos',
      app_key: KEY,
      app_secret: SEC,
      param: [{
        pagina,
        registros_por_pagina: 50,
        apenas_importado_api: 'N',
        filtrar_por_data_de: dataBR,
        filtrar_por_data_ate: dataBR
      }]
    })
  });
  const d = await r.json();
  if (d.faultstring) throw new Error(d.faultstring);
  return d;
}

function extrairNF(ped) {
  const ic  = ped.infoCadastro           || {};
  const cab = ped.cabecalho              || {};
  const inf = ped.informacoes_adicionais || {};
  const det = ped.det                    || [];

  // Número da NF
  const nroNF = ic.cNumNF || ic.numero_nf || ic.cNF || '';
  if (!nroNF) return null; // pedido ainda não faturado

  // Chave NF-e (44 dígitos)
  const chave = ic.cChaveNFe || ic.chave_nfe || ic.chaveNFe || '-';

  // Data de faturamento (emissão da NF)
  const dtEmit = ic.dDtFatur || ic.data_emissao || cab.dDtPedido || '';

  // UF e cidade de entrega
  const uf     = (inf.cUFEntrega    || inf.estado_entrega    || '-').toUpperCase();
  const cidade =  inf.cCidEntrega   || inf.municipio_entrega  || '-';

  // DIFAL e FCP somados por item do pedido (onde realmente ficam)
  let difal = 0, fcp = 0;
  for (const item of det) {
    const icms_ie = item?.imposto?.icms_ie || {};
    difal += parseFloat(icms_ie.valor_icms_uf_dest   || 0) || 0;
    fcp   += parseFloat(icms_ie.valor_fcp_icms_inter || 0) || 0;
  }

  return { nroNF, chave, dtEmit, uf, cidade, difal, fcp };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  try {
    const { data: dataISO, pagina = 1 } = req.body || {};
    if (!dataISO) return res.status(400).json({ erro: 'data é obrigatória (YYYY-MM-DD)' });

    const [y, m, d] = dataISO.split('-');
    const dataBR = `${d}/${m}/${y}`;

    // Busca todas as páginas
    let paginaAtual = 1;
    let totalPags   = 1;
    const todasNFs  = [];

    do {
      const raw  = await listarPedidos(dataBR, paginaAtual);
      const peds = raw.pedido_venda_produto || [];
      totalPags  = raw.total_de_paginas || 1;

      for (const ped of peds) {
        const nf = extrairNF(ped);
        if (nf) todasNFs.push(nf);
      }

      paginaAtual++;
      if (paginaAtual <= totalPags) await sleep(400);
    } while (paginaAtual <= totalPags);

    // Se não achou NFs mas havia pedidos → debug para ver os campos reais
    if (todasNFs.length === 0) {
      // Busca de novo só pra pegar o primeiro pedido cru
      const raw0 = await listarPedidos(dataBR, 1);
      const peds0 = raw0.pedido_venda_produto || [];
      const p0 = peds0[0];

      if (p0) {
        return res.status(200).json({
          nfs: [],
          nfTotalPaginas: 1,
          _debug: {
            total_pedidos: raw0.total_de_registros,
            msg: `${peds0.length} pedido(s) encontrado(s) mas nenhum com NF. Veja infoCadastro abaixo:`,
            infoCadastro: p0.infoCadastro || {},
            det_item0_imposto: (p0.det || [])[0]?.imposto || {},
            inf_adicionais: p0.informacoes_adicionais || {}
          }
        });
      }

      return res.status(200).json({
        nfs: [],
        nfTotalPaginas: 1,
        _debug: { msg: `Nenhum pedido retornado para ${dataBR}` }
      });
    }

    return res.status(200).json({ nfs: todasNFs, nfTotalPaginas: 1 });

  } catch (e) {
    return res.status(200).json({ erro: e.message });
  }
}
