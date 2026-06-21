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

async function cotacaoVenda(moeda) {
  const hoje = new Date();
  const dezDiasAtras = new Date(hoje.getTime() - 10 * 24 * 3600 * 1000);
  const q =
    `(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@moeda='${moeda}'` +
    `&@dataInicial='${fmt(dezDiasAtras)}'` +
    `&@dataFinalCotacao='${fmt(hoje)}'` +
    `&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`;
  const url = BASE + q;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${moeda}: HTTP ${res.status}`);
  const json = await res.json();
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
