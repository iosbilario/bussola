/* Testes do motor de cálculo — node puro, sem framework.
   Rodar:  node tests/engine.test.js
   Usa o tarifas.json e o cambio.json reais do repo (dado vivo, auditável). */
"use strict";

const fs = require("fs");
const path = require("path");
const engine = require("../app.js");

const ROOT = path.join(__dirname, "..");
const cambio = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cambio.json"), "utf8"));
const tarifas = JSON.parse(fs.readFileSync(path.join(ROOT, "data/tarifas.json"), "utf8"));
const comercial = cambio.comercial;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ok  " + msg); }
  else { fail++; console.error("FAIL  " + msg); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 0.0001); }

function rank(valor, moeda, freq) {
  return engine.computeRanking({ valor: valor, moeda: moeda, freq: freq }, comercial, tarifas);
}
function ids(r) { return r.rows.map(function (x) { return x.p.id; }); }

console.log("\n— 1. modelo exato: líquido da Wise em US$ 3.000/USD bate com a fórmula —");
(function () {
  const v = 3000, c = comercial.USD;
  const convertido = v * c;                 // comercial, sem spread
  const fee = v * c * 0.0060;               // faixa <= 5000
  const iof = convertido * tarifas.iof;
  const liquidoEsperado = convertido - iof - fee;
  const r = rank(v, "USD", 12);
  const wise = r.rows.find(function (x) { return x.p.id === "wise"; });
  ok(approx(wise.liquido, liquidoEsperado), "líquido Wise = " + wise.liquido.toFixed(2) + " (esperado " + liquidoEsperado.toFixed(2) + ")");
  // banco: spread embutido + tarifa fixa, custoFee = 0
  const banco = r.rows.find(function (x) { return x.p.id === "banco"; });
  const efetivo = c * (1 - 0.038);
  const convB = v * efetivo;
  const liquidoBanco = convB - convB * tarifas.iof - 100;
  ok(approx(banco.liquido, liquidoBanco), "líquido Banco = " + banco.liquido.toFixed(2) + " (esperado " + liquidoBanco.toFixed(2) + ")");
})();

console.log("\n— 2. ranking US$ 3.000: maior líquido vence, banco perde —");
(function () {
  const r = rank(3000, "USD", 12);
  // ordenado desc por líquido
  for (let i = 1; i < r.rows.length; i++) {
    ok(r.rows[i - 1].liquido >= r.rows[i].liquido, "ordem desc mantida em " + i);
  }
  ok(r.melhor.p.id === "wise", "vencedor em 3.000 = Wise (got " + r.melhor.p.id + ")");
  ok(r.pior.p.id === "banco", "pior em 3.000 = Banco (got " + r.pior.p.id + ")");
})();

console.log("\n— 3. FLIP da Husky em valor baixo (US$ 300): tarifa fixa US$10 a torna pior que a Remessa —");
(function () {
  const baixo = rank(300, "USD", 1);
  const husky = baixo.rows.find(function (x) { return x.p.id === "husky"; });
  const remessa = baixo.rows.find(function (x) { return x.p.id === "remessa"; });
  ok(husky.liquido < remessa.liquido, "em 300: Husky (" + husky.liquido.toFixed(2) + ") < Remessa (" + remessa.liquido.toFixed(2) + ")");
  // em valor alto a Husky volta a frente da Remessa (1% < spread 1,2%)
  const alto = rank(15000, "USD", 1);
  const huskyA = alto.rows.find(function (x) { return x.p.id === "husky"; });
  const remessaA = alto.rows.find(function (x) { return x.p.id === "remessa"; });
  ok(huskyA.liquido > remessaA.liquido, "em 15.000: Husky (" + huskyA.liquido.toFixed(2) + ") > Remessa (" + remessaA.liquido.toFixed(2) + ")");
  ok(ids(baixo).indexOf("husky") > ids(alto).indexOf("husky"), "posição da Husky piora do alto pro baixo (flip confirmado)");
})();

console.log("\n— 4. edge case: valor zero/vazio não quebra e dá tudo zero —");
(function () {
  const r = rank(0, "USD", 12);
  ok(r.rows.length === 4, "4 fitas mesmo com zero");
  ok(r.rows.every(function (x) { return x.liquido === 0; }), "todos os líquidos = 0");
  ok(r.perdaAnual === 0, "perda anual = 0");
  const parsed = engine.parseVal("");
  ok(parsed === 0, "parseVal('') = 0");
  ok(engine.parseVal("1.234,56") === 1234.56, "parseVal('1.234,56') = 1234.56 (formato pt-BR)");
})();

console.log("\n— 5. NEUTRALIDADE: zerar todos os linkAfiliado não muda a ordem —");
(function () {
  const r1 = rank(3000, "USD", 12);
  const semLinks = JSON.parse(JSON.stringify(tarifas));
  semLinks.provedores.forEach(function (p) { if (p.afiliado) p.linkAfiliado = ""; });
  const r2 = engine.computeRanking({ valor: 3000, moeda: "USD", freq: 12 }, comercial, semLinks);
  ok(JSON.stringify(ids(r1)) === JSON.stringify(ids(r2)), "ranking idêntico com links zerados: " + ids(r2).join(" > "));
  // e invertendo a ordem dos provedores na entrada o ranking final é o mesmo (só matemática)
  const embaralhado = JSON.parse(JSON.stringify(tarifas));
  embaralhado.provedores.reverse();
  const r3 = engine.computeRanking({ valor: 3000, moeda: "USD", freq: 12 }, comercial, embaralhado);
  ok(JSON.stringify(ids(r1)) === JSON.stringify(ids(r3)), "ordem de entrada não afeta ranking");
})();

console.log("\n— 6. perda anual escala com a frequência —");
(function () {
  const mensal = rank(3000, "USD", 12);
  const pontual = rank(3000, "USD", 1);
  ok(approx(mensal.perdaAnual, pontual.diferenca * 12), "perda mensal = diferença * 12");
  ok(pontual.pontual === true, "freq 1 marca pontual=true");
})();

console.log("\n========================================");
console.log("  " + pass + " passaram, " + fail + " falharam");
console.log("========================================\n");
process.exit(fail === 0 ? 0 : 1);
