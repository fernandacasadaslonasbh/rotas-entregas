/**
 * Vercel Serverless Function — NFs com DIFAL/FCP (Omie Online)
 * POST { data: "YYYY-MM-DD", pagina: 1 }
 *
 * Busca pedidos faturados na Omie Online. O filtro "filtrar_por_data_de"
 * filtra por data do pedido, não por data de emissão da NF. Por isso
 * buscamos um intervalo maior (±3 dias ao redor da data pedida) e
 * filtramos por dDtFatur (data de faturamento) aqui no servidor.
 */

export const maxDuration = 60;

const KEY = '7167467499192';
const SEC = '4e3e8e18fbefee789318d4e63108c9c1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function somarDias(dataBR, delta) {
  // dataBR = "DD/MM/YYYY"
  const [d, m, y] = dataBR.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return [
    String(dt.getDate()).padStart(2, '0'),
    String(dt.getMonth() + 1).padStart(2, '0'),
    dt.getFullYear()
  ].join('/');
}

async function listarPaginaPedidos(de, ate, pagina) {
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
        filtrar_por_data_de: de,
        filtrar_por_data_ate: ate
      }]
    })
  });
  const d = await r.json();
  if (d.faultstring) throw new Error(d.faultstring);
  return d;
}

function extrairNF(ped) {
  const ic  = ped.infoCadastro           || {};
  const tot = ped.total_pedido           || {};
  const cab = ped.cabecalho              || {};
  const inf = ped.informacoes_adicionais || {};

  // Número da NF
  const nroNF = ic.cNumNF || ic.numero_nf || ic.cNF || ic.nNF || '';
  if (!nroNF) return null;

  // Data de faturamento (emissão da NF)
  const dtFatur = ic.dDtFatur || ic.data_emissao || cab.dDtPedido || '';

  return {
    nroNF,
    chave:   ic.cChaveNFe || ic.chave_nfe || ic.chaveNFe || '-',
    dtEmit:  dtFatur,
    dtFatur, // guardamos para filtrar por data
    uf:      (inf.cUFEntrega  || inf.estado_entrega  || cab.cUf     || '-').toUpperCase(),
    cidade:   inf.cCidEntrega || inf.municipio_entrega || cab.cCidade || '-',
    difal:   parseFloat(tot.nValICMSUFDest || tot.valor_icms_uf_dest || tot.icms_uf_destino || 0) || 0,
    fcp:     parseFloat(tot.nValFCPDest    || tot.valor_fcp_uf_dest  || tot.fcp_uf_destino  || 0) || 0,
    // campos de debug — removidos antes de retornar
    _ic: ic,
    _tot: tot,
    _inf: inf
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  try {
    const { data: dataISO } = req.body || {};
    if (!dataISO) return res.status(400).json({ erro: 'data é obrigatória (YYYY-MM-DD)' });

    const [y, m, d] = dataISO.split('-');
    const dataBR = `${d}/${m}/${y}`;

    // Janela de ±3 dias para capturar NFs emitidas próximo à data do pedido
    const de  = somarDias(dataBR, -3);
    const ate = somarDias(dataBR, +3);

    // Busca todas as páginas dentro da janela
    let paginaAtual = 1;
    let totalPags   = 1;
    const todosNF   = [];

    do {
      const raw = await listarPaginaPedidos(de, ate, paginaAtual);
      const peds = raw.pedido_venda_produto || [];
      totalPags  = raw.total_de_paginas || 1;

      for (const ped of peds) {
        const nf = extrairNF(ped);
        if (nf) todosNF.push(nf);
      }

      paginaAtual++;
      if (paginaAtual <= totalPags) await sleep(400);
    } while (paginaAtual <= totalPags);

    // Filtra pela data exata de faturamento
    const nfsDoDia = todosNF.filter(nf => {
      if (!nf.dtFatur) return false;
      // dtFatur pode vir como "DD/MM/YYYY HH:MM:SS" ou "DD/MM/YYYY"
      return nf.dtFatur.startsWith(dataBR);
    });

    // Se não achou nenhuma NF no dia mas tem NFs na janela → debug
    if (nfsDoDia.length === 0 && todosNF.length > 0) {
      const primeiro = todosNF[0];
      return res.status(200).json({
        nfs: [],
        nfTotalPaginas: 1,
        _debug: {
          msg: `Encontrei ${todosNF.length} NF(s) na janela ±3 dias, mas nenhuma com dDtFatur = ${dataBR}`,
          datas_fatur_encontradas: [...new Set(todosNF.map(n => n.dtFatur))].slice(0, 10),
          exemplo_infoCadastro: primeiro._ic,
          exemplo_total_pedido: primeiro._tot,
          exemplo_inf_adicionais: primeiro._inf
        }
      });
    }

    // Se não achou nada nem na janela → debug
    if (nfsDoDia.length === 0 && todosNF.length === 0) {
      return res.status(200).json({
        nfs: [],
        nfTotalPaginas: 1,
        _debug: {
          msg: `Nenhum pedido faturado na janela ${de} a ${ate}. Tente uma data com vendas recentes.`
        }
      });
    }

    // Retorna limpinho, sem os campos _ic/_tot/_inf
    const nfs = nfsDoDia.map(({ nroNF, chave, dtEmit, uf, cidade, difal, fcp }) =>
      ({ nroNF, chave, dtEmit, uf, cidade, difal, fcp })
    );

    return res.status(200).json({ nfs, nfTotalPaginas: 1 });

  } catch (e) {
    return res.status(200).json({ erro: e.message });
  }
}
