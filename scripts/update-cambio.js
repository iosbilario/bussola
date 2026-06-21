/* Atualiza data/cambio.json com a PTAX de fechamento mais recente do BACEN.
   Fonte: API olinda (gratuita, oficial). Usa a cotação de VENDA.
   Roda no CI (node 20+, fetch global). Sem dependências. */
"use strict";

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "data", "cambio.json");
const MOEDAS = ["USD", "EUR"];
const BASE = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo";

// olinda usa datas no formato MM-DD-YYYY
function fmt(d) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return mm + "-" + dd + "-" + d.getUTCFullYear();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// olinda (BACEN) costuma devolver 502/503 intermitente sob carga — tentamos
// algumas vezes com backoff antes de desistir.
async function fetchComRetry(url, tentativas = 5) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) return res.json();
      // 5xx e 429 são transitórios; 4xx (exceto 429) não adianta repetir
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} (definitivo)`);
      }
      ultimoErro = new Error(`HTTP ${res.status}`);
    } catch (err) {
      ultimoErro = err; // erro de rede também é transitório
    }
    if (i < tentativas - 1) {
      const espera = 1000 * Math.pow(2, i); // 1s, 2s, 4s, 8s
      console.warn(`  tentativa ${i + 1} falhou (${ultimoErro.message}) — repetindo em ${espera}ms`);
      await sleep(espera);
    }
  }
  throw ultimoErro;
}

async function cotacaoVenda(moeda) {
  const hoje = new Date();
  const dezDiasAtras = new Date(hoje.getTime() - 10 * 24 * 3600 * 1000);
  const q =
    `(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@moeda='${moeda}'` +
    `&@dataInicial='${fmt(dezDiasAtras)}'` +
    `&@dataFinalCotacao='${fmt(hoje)}'` +
    `&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`;
  const json = await fetchComRetry(BASE + q).catch((e) => {
    throw new Error(`${moeda}: ${e.message}`);
  });
  const row = json && json.value && json.value[0];
  if (!row || typeof row.cotacaoVenda !== "number") {
    throw new Error(`${moeda}: sem cotação no período`);
  }
  return Math.round(row.cotacaoVenda * 1e4) / 1e4; // 4 casas
}

(async function main() {
  const comercial = {};
  for (const m of MOEDAS) {
    comercial[m] = await cotacaoVenda(m);
    console.log(`PTAX ${m} venda = ${comercial[m]}`);
  }
  const out = {
    atualizadoEm: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    fonte: "PTAX/BACEN",
    comercial: comercial
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("Escrito " + OUT);
})().catch(function (err) {
  console.error("Falha ao atualizar câmbio:", err.message);
  process.exit(1);
});
