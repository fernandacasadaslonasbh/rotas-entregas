/**
 * Vercel Serverless Function — NFs com DIFAL/FCP (Omie Online)
 * POST { data: "YYYY-MM-DD", pagina: 1 }
 * Usa ListarPedidos filtrado por data e retorna pedidos que têm NF emitida.
 */

export const maxDuration = 60;

const KEY = '7167467499192';
const SEC = '4e3e8e18fbefee789318d4e63108c9c1';

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
  const ic  = ped.infoCadastro           || {};
  const tot = ped.total_pedido           || {};
  const cab = ped.cabecalho              || {};
  const inf = ped.informacoes_adicionais || {};

  // Número da NF — tenta vários nomes de campo do Omie
  const nroNF = ic.cNumNF || ic.numero_nf || ic.cNF || ic.nNF || '';
  if (!nroNF) return null; // pedido ainda não faturado

  const chave  = ic.cChaveNFe || ic.chave_nfe || ic.chaveNFe || '-';
  const dtEmit = ic.dDtFatur  || ic.data_emissao || cab.dDtPedido || dataBR;
  const uf     = (inf.cUFEntrega    || inf.estado_entrega    || cab.cUf    || '-').toUpperCase();
  const cidade =  inf.cCidEntrega   || inf.municipio_entrega  || cab.cCidade || '-';
  const difal  = parseFloat(tot.nValICMSUFDest || tot.valor_icms_uf_dest || tot.icms_uf_destino || 0) || 0;
  const fcp    = parseFloat(tot.nValFCPDest    || tot.valor_fcp_uf_dest  || tot.fcp_uf_destino  || 0) || 0;

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
    const nfTotalPaginas     = raw.total_de_paginas    || 1;
    const total_de_registros = raw.total_de_registros  || 0;

    const nfs = peds.map(p => extrairNF(p, dataBR)).filter(Boolean);

    // DEBUG TEMPORÁRIO: quando não acha NFs, devolve a estrutura bruta
    // do primeiro pedido para identificar os nomes corretos dos campos.
    if (nfs.length === 0 && peds.length > 0) {
      const p0 = peds[0];
      return res.status(200).json({
        nfs: [],
        nfTotalPaginas,
        total_de_registros,
        _debug: {
          total_pedidos_nesta_pagina: peds.length,
          msg: 'Nenhum pedido com NF encontrado — veja infoCadastro e total_pedido do 1º pedido abaixo',
          infoCadastro:    p0.infoCadastro           || {},
          total_pedido:    p0.total_pedido           || {},
          cabecalho_keys:  Object.keys(p0.cabecalho  || {}),
          inf_adicionais:  p0.informacoes_adicionais || {}
        }
      });
    }

    // Quando não vem nenhum pedido sequer (data sem vendas)
    if (nfs.length === 0 && peds.length === 0) {
      return res.status(200).json({
        nfs: [],
        nfTotalPaginas,
        total_de_registros,
        _debug: {
          msg: `Nenhum pedido retornado pela Omie para a data ${dataBR}. Total de registros: ${total_de_registros}`
        }
      });
    }

    return res.status(200).json({ nfs, nfTotalPaginas, total_de_registros });

  } catch (e) {
    return res.status(200).json({ erro: e.message });
  }
}
