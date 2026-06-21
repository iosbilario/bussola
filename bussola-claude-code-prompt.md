# Prompt — construir a Bússola (Claude Code)

> Cole isto no Claude Code dentro de um repositório vazio. O mockup `bussola.html` (em anexo neste repo) é a **fonte de verdade visual** — clone a aparência dele, mude só o que o prompt mandar.

---

Você vai construir o **Bússola**: a camada de decisão de câmbio para PJ/dev brasileiro que recebe de cliente gringo em USD/EUR. O herói é uma calculadora-comparador "quanto cai no seu bolso" que mostra, sem viés, o R$ líquido em Wise, Husky by Nomad, Remessa Online e banco tradicional — com cada taxa aberta. Transparência radical é o produto.

## Princípios inegociáveis
- **Neutralidade**: o ranking é só matemática. Vence quem entrega mais R$, ponto. Link de afiliado **nunca** reordena nada.
- **Exatidão**: cada provedor tem um **modelo de custo diferente** e a UI mostra isso. Não use um "spread genérico" pra todos.
- **Custo zero**: GitHub Pages + GitHub Actions. Sem backend, sem banco, sem servidor pago. Cálculo 100% client-side.
- **Dado vivo e auditável**: câmbio comercial e tarifas entram por automação; o histórico de tarifas vive no **git** (cada commit = um snapshot temporal datado — mesmo padrão do Observatório de Taxas).

## Stack
- HTML/CSS/JS vanilla, single-file ou no máximo `index.html` + `app.js` + `data/`. Sem framework, sem build step.
- Deploy: GitHub Pages a partir de `/` (branch `main`).
- Automação: GitHub Actions agendado (cron) que atualiza os dados e dá commit.

## Arquitetura de dados

### 1. Câmbio comercial — `data/cambio.json`
Fonte: **PTAX do Banco Central** (olinda/SGS), oficial e gratuita. USD/BRL e EUR/BRL, cotação de venda do fechamento mais recente.
- Endpoint olinda PTAX (exemplo): `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@data)`
- Action diária (dias úteis, ~13h BRT após o fechamento PTAX) reescreve `cambio.json`:
```json
{
  "atualizadoEm": "2026-06-19T16:05:00Z",
  "fonte": "PTAX/BACEN",
  "comercial": { "USD": 5.4021, "EUR": 5.8634 }
}
```

### 2. Tarifas dos provedores — `data/tarifas.json`
Não existe API pública limpa pra todas. Então este arquivo é **versionado à mão** (ou semi-automatizado onde os termos permitirem), com `verificadoEm` e `fonte` por provedor — é isso que sustenta a credibilidade. Cada commit vira um ponto na linha do tempo.
```json
{
  "iof": 0.0038,
  "provedores": [
    { "id":"wise", "nome":"Wise", "sub":"recebimento multimoeda",
      "modelo":"comercial", "afiliado":true,
      "fee":{ "tipo":"percent_faixa", "faixas":[{"ateMoeda":5000,"pct":0.0060},{"ateMoeda":null,"pct":0.0045}] },
      "linkAfiliado":"", "fonte":"wise.com/pricing", "verificadoEm":"2026-06-19" },
    { "id":"husky", "nome":"Husky by Nomad", "sub":"conta global integrada",
      "modelo":"comercial", "afiliado":true,
      "fee":{ "tipo":"operacional_tier", "flatMoedaAte":{"limite":1000,"flatMoeda":10}, "pctAcima":0.01 },
      "linkAfiliado":"", "fonte":"husky.io", "verificadoEm":"2026-06-19" },
    { "id":"remessa", "nome":"Remessa Online", "sub":"foco em PJ exportador",
      "modelo":"spread", "afiliado":true,
      "fee":{ "tipo":"spread", "spreadPct":0.012, "tarifaFixaBRL":0 },
      "linkAfiliado":"", "fonte":"remessaonline.com.br", "verificadoEm":"2026-06-19" },
    { "id":"banco", "nome":"Banco tradicional", "sub":"ordem de pagamento",
      "modelo":"spread", "afiliado":false,
      "fee":{ "tipo":"spread", "spreadPct":0.038, "tarifaFixaBRL":100 },
      "linkAfiliado":null, "fonte":"referência de mercado", "verificadoEm":"2026-06-19" }
  ]
}
```
> Opcional: a Wise publica preços programaticamente — se der, crie um job que atualize só a faixa da Wise automaticamente e deixe os demais manuais. Sempre carimbe `verificadoEm`.

## Modelo de cálculo (client-side, exato)
Para um valor `v` na moeda `m`, com `c = comercial[m]`:
```
brutoComercial = v * c                       // a régua (a verdade)

modelo "comercial" (Wise, Husky):
  convertido = v * c                          // usa o câmbio comercial, SEM spread
  custoFee   = fee aplicado (percent_faixa | operacional_tier) em BRL
modelo "spread" (Remessa, banco):
  efetivo    = c * (1 - spreadPct)            // spread embutido piora o câmbio
  convertido = v * efetivo
  custoFee   = 0                              // o custo já está no câmbio

iof     = convertido * 0.0038                 // tributo, igual pra todos
tarifa  = tarifaFixaBRL (se houver)
liquido = convertido - iof - custoFee - tarifa
mordida = brutoComercial - liquido            // quanto foi comido no total
```
Ranking = ordenar por `liquido` desc. **Vencedor = maior líquido**, sempre, sem exceção.
Perda anual = `(liquidoVencedor - liquidoPior) * frequenciaAnual` (mensal=12, quinzenal=24, semanal=52, pontual=1 → rótulo "nesta operação").

Edge cases obrigatórios: valor vazio/zero (não quebrar, mostrar zeros), valores muito baixos (a tarifa fixa US$10 da Husky pode torná-la pior que a Remessa — o ranking precisa refletir esse flip), arredondamento sempre em centavos com `Intl.NumberFormat('pt-BR')`.

## UI e direção visual
Replique o mockup `bussola.html` à risca. Resumo dos tokens (o resto está no arquivo):
- **Paleta**: cofre `#0E1611` (fundo) · papel-recibo `#ECE4D2` (fitas) · âmbar `#E0922E` (vencedor) · carimbo `#B23A2B` (perda/spread) · aço `#7CA0AC` (régua do comercial).
- **Tipos**: Martian Mono (números-herói/letreiro) · Hanken Grotesk (texto) · Spline Sans Mono (linhas do recibo). Nada de Inter/Geist.
- **Assinatura**: as 4 "fitas de recibo" com borda serrilhada que descascam a grana linha a linha até o R$ em âmbar; a régua do câmbio comercial como verdade-zero; o carimbo vermelho da perda anual.
- **Decomposição honesta por modelo**: provedores "comercial" mostram `Câmbio comercial → Convertido → Fee/Taxa operacional`; provedores "spread" mostram `Câmbio comercial → Câmbio aplicado (−x%) → Convertido`. A diferença visual entre os dois modelos é o coração da transparência — preserve.
- Tag de modelo em cada fita ("câmbio comercial + fee" vs "spread embutido").

## Afiliados e disclosure
- Cada provedor com `afiliado:true` renderiza "Abrir conta" → `linkAfiliado`. Se `linkAfiliado` vazio, botão desabilitado com tooltip "em breve".
- Sob cada CTA: "link de afiliado · não altera o ranking". Provedor sem afiliado (banco) mostra "conta via gerente / agência", sem botão.
- Página `/metodologia` (ou seção) explicando: as fontes, o IOF como tributo igual pra todos, a regra de neutralidade, e a divulgação de afiliado. Honestidade é o moat — escreva como engenheiro, não como vendedor.

## Piso de qualidade
- Responsivo até 360px (fitas empilham). Foco de teclado visível (outline âmbar). `prefers-reduced-motion` respeitado (sem count-up). **Sem localStorage/sessionStorage** — estado em memória.
- Lighthouse ≥ 95 em Performance e Acessibilidade. Sem dependências externas além das Google Fonts.
- `data/*.json` carregado via `fetch` no load; fallback gracioso se offline (usa último valor embutido + avisa "dados podem estar desatualizados").

## Estrutura sugerida
```
/index.html            # a calculadora (visual = bussola.html)
/app.js                # motor de cálculo + render + fetch dos dados
/data/cambio.json      # PTAX, atualizado por Action
/data/tarifas.json     # tarifas versionadas (snapshot temporal no git)
/.github/workflows/cambio.yml    # cron diário: atualiza cambio.json
/metodologia.html      # fontes, neutralidade, disclosure
/README.md
```

## Definition of Done
1. `index.html` abre e calcula offline com os JSON locais; números batem com o modelo acima.
2. Trocar valor/moeda/frequência reordena o ranking corretamente, incluindo o flip da Husky em valores baixos.
3. A Action de câmbio roda, busca PTAX e commita `cambio.json` (testar com `workflow_dispatch`).
4. Afiliado nunca muda a ordem (teste: zere os `linkAfiliado` e confirme ranking idêntico).
5. Lighthouse a11y ≥ 95; navegação 100% por teclado; reduced-motion sem animação.
6. README explica como atualizar `tarifas.json` e de onde vem cada número.

## Primeiros passos
1. Gere a estrutura e porte o visual do `bussola.html` para `index.html` + `app.js`, trocando os parâmetros embutidos por `fetch('data/*.json')`.
2. Implemente o motor de cálculo exatamente como especificado e escreva 4–5 testes (node, sem framework) cobrindo os edge cases e o flip.
3. Crie a Action de PTAX com `workflow_dispatch` + cron e teste manualmente.
4. Pare e me mostre o ranking calculado para US$ 3.000/mês, US$ 800/mês e US$ 15.000/mês antes de seguir pro deploy.
