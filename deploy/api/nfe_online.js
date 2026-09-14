/**
 * Vercel Serverless Function — NFs com DIFAL/FCP (Omie Online)
 * POST { data: "YYYY-MM-DD", pagina: 1 }
 * Usa ListarPedidos filtrado por data e retorna pedidos que têm NF emitida.
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

function extrairNF(ped, dataBR) {
  const ic  = ped.infoCadastro         || {};
  const tot = ped.total_pedido         || {};
  const cab = ped.cabecalho            || {};
  const inf = ped.informacoes_adicionais || {};

  // Número da NF — tenta vários nomes de campo do Omie
  const nroNF = ic.cNumNF || ic.numero_nf || ic.cNF || '';
  if (!nroNF) return null; // pedido ainda não faturado

  // Chave de acesso da NF-e (44 dígitos)
  const chave = ic.cChaveNFe || ic.chave_nfe || ic.chaveNFe || '-';

  // Data de emissão / faturamento
  const dtEmit = ic.dDtFatur || ic.data_emissao || cab.dDtPedido || dataBR;

  // UF e cidade de entrega (endereço de destino do pedido)
  const uf     = (inf.cUFEntrega    || inf.estado_entrega    || cab.cUf    || '-').toUpperCase();
  const cidade =  inf.cCidEntrega   || inf.municipio_entrega  || cab.cCidade || '-';

  // DIFAL (ICMS destinatário) e FCP
  const difal = parseFloat(
    tot.nValICMSUFDest || tot.valor_icms_uf_dest || tot.icms_uf_destino || 0
  ) || 0;
  const fcp = parseFloat(
    tot.nValFCPDest    || tot.valor_fcp_uf_dest  || tot.fcp_uf_destino  || 0
  ) || 0;

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

    const raw = await listarPedidos(dataBR, pagina);

    const peds = raw.pedido_venda_produto || [];
    const nfTotalPaginas    = raw.total_de_paginas    || 1;
    const total_de_registros = raw.total_de_registros || 0;

    const nfs = peds
      .map(p => extrairNF(p, dataBR))
      .filter(Boolean);

    return res.status(200).json({ nfs, nfTotalPaginas, total_de_registros });

  } catch (e) {
    return res.status(200).json({ erro: e.message });
  }
}
