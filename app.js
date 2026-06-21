/* Bússola — motor de cálculo + render + fetch dos dados.
   Cálculo 100% client-side. As funções puras (computeRanking, quote, fee*)
   também são exportadas para os testes node ao final do arquivo. */
(function (root) {
  "use strict";

  var SYM = { USD: "US$", EUR: "€" };

  // ── fallback embutido: último snapshot conhecido, usado se o fetch falhar ──
  var FALLBACK_CAMBIO = {
    atualizadoEm: "2026-06-19T16:05:00Z",
    fonte: "PTAX/BACEN",
    comercial: { USD: 5.4021, EUR: 5.8634 }
  };
  var FALLBACK_TARIFAS = {
    iof: 0.0038,
    provedores: [
      { id: "wise", nome: "Wise", sub: "recebimento multimoeda", modelo: "comercial", afiliado: true,
        fee: { tipo: "percent_faixa", faixas: [{ ateMoeda: 5000, pct: 0.0060 }, { ateMoeda: null, pct: 0.0045 }] },
        linkAfiliado: "", fonte: "wise.com/pricing", verificadoEm: "2026-06-19" },
      { id: "husky", nome: "Husky by Nomad", sub: "conta global integrada", modelo: "comercial", afiliado: true,
        fee: { tipo: "operacional_tier", flatMoedaAte: { limite: 1000, flatMoeda: 10 }, pctAcima: 0.01 },
        linkAfiliado: "", fonte: "husky.io", verificadoEm: "2026-06-19" },
      { id: "remessa", nome: "Remessa Online", sub: "foco em PJ exportador", modelo: "spread", afiliado: true,
        fee: { tipo: "spread", spreadPct: 0.012, tarifaFixaBRL: 0 },
        linkAfiliado: "", fonte: "remessaonline.com.br", verificadoEm: "2026-06-19" },
      { id: "banco", nome: "Banco tradicional", sub: "ordem de pagamento", modelo: "spread", afiliado: false,
        fee: { tipo: "spread", spreadPct: 0.038, tarifaFixaBRL: 100 },
        linkAfiliado: null, fonte: "referência de mercado", verificadoEm: "2026-06-19" }
    ]
  };

  // ── formatação (sempre em centavos, padrão pt-BR) ──
  var fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  function brl(n) { return fmtBRL.format(n); }
  function pct(x) { return (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; }
  function num4(n) { return n.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }
  function int(n) { return Math.round(n).toLocaleString("pt-BR"); }
  function curFmt(n, m) { return SYM[m] + " " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // ── interpretação declarativa do modelo de custo de cada provedor ──
  // Retorna { spreadPct, custoBRL, tarifaBRL, custoLabel, custoDesc, tarifaLabel }.
  function computeFee(p, v, c, m) {
    var f = p.fee;
    if (f.tipo === "percent_faixa") {
      var taxa = null;
      for (var i = 0; i < f.faixas.length; i++) {
        var fx = f.faixas[i];
        if (fx.ateMoeda === null || v <= fx.ateMoeda) { taxa = fx.pct; break; }
      }
      if (taxa === null) taxa = f.faixas[f.faixas.length - 1].pct;
      return { spreadPct: 0, custoBRL: v * c * taxa, tarifaBRL: 0,
               custoLabel: "Fee de conversão", custoDesc: pct(taxa) };
    }
    if (f.tipo === "operacional_tier") {
      if (v <= f.flatMoedaAte.limite) {
        return { spreadPct: 0, custoBRL: f.flatMoedaAte.flatMoeda * c, tarifaBRL: 0,
                 custoLabel: "Taxa operacional", custoDesc: SYM[m] + " " + f.flatMoedaAte.flatMoeda + " fixo" };
      }
      return { spreadPct: 0, custoBRL: v * c * f.pctAcima, tarifaBRL: 0,
               custoLabel: "Taxa operacional", custoDesc: pct(f.pctAcima) };
    }
    if (f.tipo === "spread") {
      return { spreadPct: f.spreadPct, custoBRL: 0, tarifaBRL: f.tarifaFixaBRL || 0,
               custoLabel: "Spread", custoDesc: pct(f.spreadPct),
               tarifaLabel: p.id === "banco" ? "Tarifa de ordem de pagamento" : "Tarifa fixa" };
    }
    throw new Error("tipo de fee desconhecido: " + f.tipo);
  }

  // tag de modelo exibida em cada fita
  function modeloTag(p) {
    var f = p.fee;
    if (f.tipo === "percent_faixa") return "câmbio comercial + fee";
    if (f.tipo === "operacional_tier") return "câmbio comercial + taxa op.";
    if (f.tipo === "spread") return (f.tarifaFixaBRL > 0) ? "spread + tarifa fixa" : "spread embutido";
    return "";
  }

  // ── motor: cotação de um provedor para (valor, moeda) ──
  // Implementa EXATAMENTE o modelo da especificação.
  function quote(p, v, m, comercial, iof) {
    var c = comercial[m];

    // valor vazio/zero: não cobramos taxa fixa sobre um não-recebimento —
    // tudo zera (evita líquido negativo e mantém a UI inteira).
    if (!(v > 0)) {
      return {
        p: p,
        linhas: [
          { k: "Recebido", v: curFmt(0, m), cls: "" },
          { k: "Câmbio comercial", v: num4(c), cls: p.modelo === "comercial" ? "base" : "mut" },
          { k: "Convertido", v: brl(0), cls: "" }
        ],
        liquido: 0, convertido: 0, iof: 0, custoFee: 0, tarifa: 0,
        efetivo: c, brutoComercial: 0, mordida: 0, mordidaPct: 0
      };
    }

    var brutoComercial = v * c;                 // a régua: o real puro
    var f = computeFee(p, v, c, m);
    var efetivo = c * (1 - f.spreadPct);        // spread piora o câmbio (0 nos modelos "comercial")
    var convertido = v * efetivo;
    var iofVal = convertido * iof;              // tributo, igual pra todos
    var custoFee = p.modelo === "comercial" ? f.custoBRL : 0;
    var tarifa = f.tarifaBRL || 0;
    var liquido = convertido - iofVal - custoFee - tarifa;

    // linhas de decomposição honesta — diferentes por modelo
    var linhas = [{ k: "Recebido", v: curFmt(v, m), cls: "" }];
    if (p.modelo === "comercial") {
      linhas.push({ k: "Câmbio comercial", v: num4(c), cls: "base" });
      linhas.push({ k: "Convertido", v: brl(convertido), cls: "" });
      linhas.push({ k: f.custoLabel + " (" + f.custoDesc + ")", v: "− " + brl(custoFee), cls: "neg" });
    } else {
      linhas.push({ k: "Câmbio comercial", v: num4(c), cls: "mut" });
      linhas.push({ k: "Câmbio aplicado (−" + f.custoDesc + ")", v: num4(efetivo), cls: "neg" });
      linhas.push({ k: "Convertido", v: brl(convertido), cls: "" });
    }
    linhas.push({ k: "IOF " + pct(iof), v: "− " + brl(iofVal), cls: "neg" });
    if (tarifa > 0) linhas.push({ k: f.tarifaLabel, v: "− " + brl(tarifa), cls: "neg" });

    return {
      p: p, linhas: linhas,
      liquido: liquido,
      convertido: convertido,
      iof: iofVal, custoFee: custoFee, tarifa: tarifa,
      efetivo: efetivo,
      brutoComercial: brutoComercial,
      mordida: brutoComercial - liquido,
      mordidaPct: brutoComercial > 0 ? (brutoComercial - liquido) / brutoComercial : 0
    };
  }

  // ── ranking: só matemática. Ordena por líquido desc. Empate → ordem estável. ──
  function computeRanking(state, comercial, tarifas) {
    var v = state.valor, m = state.moeda;
    var rows = tarifas.provedores.map(function (p) { return quote(p, v, m, comercial, tarifas.iof); });
    rows.sort(function (a, b) { return b.liquido - a.liquido; });
    var melhor = rows[0], pior = rows[rows.length - 1];
    var dif = melhor.liquido - pior.liquido;
    return {
      rows: rows,
      melhor: melhor, pior: pior,
      diferenca: dif,
      perdaAnual: dif * state.freq,
      pontual: state.freq === 1
    };
  }

  function parseVal(raw) {
    var s = String(raw).replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  var engine = {
    SYM: SYM, brl: brl, pct: pct, num4: num4, int: int, curFmt: curFmt,
    computeFee: computeFee, modeloTag: modeloTag, quote: quote,
    computeRanking: computeRanking, parseVal: parseVal,
    FALLBACK_CAMBIO: FALLBACK_CAMBIO, FALLBACK_TARIFAS: FALLBACK_TARIFAS
  };

  // ── node: exporta só o motor puro e encerra (sem DOM) ──
  if (typeof module !== "undefined" && module.exports) {
    module.exports = engine;
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // A partir daqui: wiring de UI (só roda no browser).
  // ─────────────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var state = { valor: 3000, moeda: "USD", freq: 12 };
  var DATA = { comercial: FALLBACK_CAMBIO.comercial, tarifas: FALLBACK_TARIFAS, atualizadoEm: FALLBACK_CAMBIO.atualizadoEm, stale: false };

  var freqByVal = function (f) { return { 12: "por mês", 24: "a cada quinzena", 52: "por semana", 1: "de forma pontual" }[f]; };

  function animate(el, to, fmt) {
    if (reduce) { el.textContent = fmt(to); return; }
    var from = parseFloat(el.getAttribute("data-v") || "0");
    if (from === to) { el.textContent = fmt(to); return; }
    el.setAttribute("data-v", to);
    var t0 = null, dur = 480;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
    }
    requestAnimationFrame(step);
  }

  var fitasEl;

  function render() {
    var c = DATA.comercial[state.moeda];
    document.getElementById("reguaVal").textContent =
      (state.valor * c).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    var rank = computeRanking(state, DATA.comercial, DATA.tarifas);
    var rows = rank.rows;
    fitasEl.innerHTML = "";

    rows.forEach(function (r, i) {
      var p = r.p, win = i === 0, bad = i === rows.length - 1;
      var card = document.createElement("div");
      card.className = "fita" + (win ? " vence" : "") + (bad ? " pior" : "");
      var selo = win ? '<span class="selo win">mais real no bolso</span>'
        : bad ? '<span class="selo bad">mais cara</span>' : "";
      var lns = r.linhas.map(function (l) {
        return '<div class="ln ' + (l.cls === "base" ? "base" : "") + '"><span class="k">' + l.k +
          '</span><span class="v ' + (l.cls === "neg" ? "neg" : l.cls === "mut" ? "mut" : "") + '">' + l.v + "</span></div>";
      }).join("");

      var cta;
      if (p.afiliado) {
        var hasLink = p.linkAfiliado && p.linkAfiliado.length > 0;
        if (hasLink) {
          cta = '<div class="cta"><a href="' + p.linkAfiliado + '" target="_blank" rel="noopener sponsored" ' +
            'aria-label="abrir conta na ' + p.nome + ', link de afiliado">Abrir conta<span class="arrow">→</span></a>' +
            '<span class="afil">link de afiliado · não altera o ranking</span></div>';
        } else {
          cta = '<div class="cta"><a href="#" aria-disabled="true" tabindex="-1" title="em breve" ' +
            'class="off" aria-label="abrir conta na ' + p.nome + ' (em breve)">Abrir conta<span class="arrow">→</span></a>' +
            '<span class="afil">link de afiliado · não altera o ranking</span></div>';
        }
      } else {
        cta = '<div class="cta nope"><span>conta via gerente / agência</span></div>';
      }

      card.innerHTML =
        '<div class="fhead"><div><div class="fnome">' + p.nome + '</div><div class="fsub">' + p.sub + "</div>" +
        '<span class="modelo ' + p.modelo + '">' + modeloTag(p) + "</span></div>" + selo + "</div>" +
        '<div class="linhas">' + lns + "</div>" +
        '<div class="total"><span class="tk">cai no seu bolso</span><span class="tv num" data-liq="' + p.id + '">R$ 0</span></div>' +
        '<div class="mordida"><div class="mtop"><span>perdido pra spread + taxa</span><b>− ' + brl(r.mordida) +
        " · " + (r.mordidaPct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%</b></div>" +
        '<div class="bar"><i style="width:' + Math.max(4, Math.min(100, r.mordidaPct * 100 / 0.06 * 100)).toFixed(1) + '%"></i></div></div>' +
        cta;
      fitasEl.appendChild(card);
      animate(card.querySelector("[data-liq]"), r.liquido, function (x) { return brl(x); });
    });

    animate(document.getElementById("perda"), rank.perdaAnual, function (x) { return int(x); });
    document.getElementById("perdaPer").textContent = rank.pontual ? "nesta operação" : "por ano";
    document.getElementById("exPer").textContent = rank.pontual ? "nesta transferência" : "por ano";
    document.getElementById("exVal").textContent = curFmt(state.valor, state.moeda).replace(",00", "");
    document.getElementById("exFreq").textContent = freqByVal(state.freq);
    document.getElementById("exDet").textContent =
      "melhor: " + rank.melhor.p.nome + " · pior: " + rank.pior.p.nome + " · diferença por recebimento: " + brl(rank.diferenca);
  }

  function wireInputs() {
    var valorEl = document.getElementById("valor"), sliderEl = document.getElementById("slider");
    valorEl.addEventListener("input", function () {
      var n = parseVal(valorEl.value); state.valor = n;
      if (n >= 200 && n <= 40000) sliderEl.value = n;
      render();
    });
    valorEl.addEventListener("blur", function () { valorEl.value = state.valor.toLocaleString("pt-BR"); });
    sliderEl.addEventListener("input", function () {
      state.valor = parseFloat(sliderEl.value);
      valorEl.value = state.valor.toLocaleString("pt-BR");
      render();
    });
    document.getElementById("moeda").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.moeda = b.getAttribute("data-cur");
      [].forEach.call(this.children, function (x) { x.setAttribute("aria-pressed", x === b); });
      document.getElementById("cur").textContent = SYM[state.moeda];
      render();
    });
    document.getElementById("freq").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.freq = parseFloat(b.getAttribute("data-f"));
      [].forEach.call(this.children, function (x) { x.setAttribute("aria-pressed", x === b); });
      render();
    });
  }

  function updateTicker() {
    document.getElementById("tkUSD").textContent = num4(DATA.comercial.USD);
    document.getElementById("tkEUR").textContent = num4(DATA.comercial.EUR);
  }

  function startAgo() {
    var atualizado = DATA.atualizadoEm ? new Date(DATA.atualizadoEm).getTime() : Date.now();
    var agoEl = document.getElementById("ago");
    function fmtAgo() {
      var s = Math.max(0, Math.floor((Date.now() - atualizado) / 1000));
      if (s < 60) return s + "s";
      if (s < 3600) return Math.floor(s / 60) + "min";
      if (s < 86400) return Math.floor(s / 3600) + "h";
      return Math.floor(s / 86400) + "d";
    }
    agoEl.textContent = fmtAgo();
    if (!reduce) setInterval(function () { agoEl.textContent = fmtAgo(); }, 1000);
  }

  function showStale() {
    var el = document.getElementById("staleAviso");
    if (el) el.hidden = false;
  }

  // ── fetch dos dados vivos; fallback gracioso se offline ──
  function loadData() {
    var cambioP = fetch("data/cambio.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("cambio " + r.status); return r.json();
    });
    var tarifasP = fetch("data/tarifas.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("tarifas " + r.status); return r.json();
    });
    return Promise.all([cambioP, tarifasP]).then(function (res) {
      DATA.comercial = res[0].comercial;
      DATA.atualizadoEm = res[0].atualizadoEm;
      DATA.tarifas = res[1];
    }).catch(function (err) {
      // offline / falha: mantém fallback embutido e avisa
      DATA.stale = true;
      showStale();
      if (window.console) console.warn("Bússola: usando dados embutidos (fetch falhou):", err && err.message);
    });
  }

  function init() {
    fitasEl = document.getElementById("fitas");
    wireInputs();
    loadData().then(function () {
      updateTicker();
      startAgo();
      render();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
