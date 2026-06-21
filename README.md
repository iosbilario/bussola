# Bússola

**A camada de decisão de câmbio para quem recebe de fora.** Calculadora-comparador
neutra que mostra, sem viés, quanto cai no seu bolso (R$ líquido) ao receber em
USD/EUR via **Wise**, **Husky by Nomad**, **Remessa Online** e **banco tradicional** —
com cada taxa aberta.

O ranking é só matemática: vence quem entrega mais real. Link de afiliado nunca
reordena nada. Transparência radical é o produto.

→ Metodologia, fontes e divulgação de afiliados: [`metodologia.html`](metodologia.html).

## Stack & princípios

- HTML/CSS/JS **vanilla**. Sem framework, sem build step. Cálculo 100% client-side.
- Custo zero: **GitHub Pages** (deploy de `/` na branch `main`) + **GitHub Actions**.
- Sem backend, banco ou servidor. Sem `localStorage`/`sessionStorage` — estado em memória.
- Dado vivo e auditável: câmbio entra por automação; o histórico de tarifas vive no git
  (cada commit = um snapshot temporal datado).

## Estrutura

```
index.html                  calculadora (porta o visual de bussola.html)
app.js                      motor de cálculo + render + fetch dos dados
metodologia.html            fontes, neutralidade, IOF, divulgação de afiliados
data/cambio.json            PTAX comercial — reescrito pela Action
data/tarifas.json           tarifas versionadas à mão (snapshot no git)
scripts/update-cambio.js    busca PTAX (olinda/BACEN) e reescreve cambio.json
.github/workflows/cambio.yml cron diário + workflow_dispatch
tests/engine.test.js        testes do motor (node puro, sem framework)
bussola.html                mockup visual original (referência)
```

## Rodar localmente

`fetch` exige servir por HTTP (não abra via `file://`). Qualquer servidor estático serve:

```bash
python -m http.server 8000        # ou:  npx serve .
# abra http://localhost:8000
```

Se o `fetch` falhar (offline), a página usa o último snapshot **embutido** em `app.js`
e mostra o aviso "dados podem estar desatualizados".

## Testes

```bash
node tests/engine.test.js
```

Cobrem: o modelo de cálculo exato, o ranking, o **flip da Husky** em valores baixos
(a taxa fixa de US$ 10 a torna pior que a Remessa), o edge case de valor zero/vazio,
e a **neutralidade** (zerar os `linkAfiliado` não muda a ordem).

## Modelo de cálculo

Para um valor `v` na moeda `m`, com `c = comercial[m]`:

```
brutoComercial = v * c                       // a régua (a verdade)

modelo "comercial" (Wise, Husky):
  convertido = v * c                          // câmbio comercial, SEM spread
  custoFee   = fee aplicado (faixa | tier) em BRL
modelo "spread" (Remessa, banco):
  efetivo    = c * (1 - spreadPct)            // spread embutido piora o câmbio
  convertido = v * efetivo
  custoFee   = 0                              // o custo já está no câmbio

iof     = convertido * 0.0038                 // tributo, igual pra todos
tarifa  = tarifaFixaBRL (se houver)
liquido = convertido - iof - custoFee - tarifa
```

Ranking = ordenar por `liquido` desc. Perda anual = `(líquidoVencedor − líquidoPior) × frequência`
(mensal=12, quinzenal=24, semanal=52, pontual=1 → rótulo "nesta operação").

## De onde vem cada número

### `data/cambio.json` — câmbio comercial (automático)

PTAX do Banco Central (cotação de **venda** do fechamento mais recente), via API
olinda — oficial e gratuita. Atualizado pela Action `.github/workflows/cambio.yml`,
que roda `scripts/update-cambio.js` em dias úteis (~13h BRT) e commita se houve mudança.

Testar a Action manualmente: aba **Actions → Atualiza câmbio PTAX → Run workflow**
(gatilho `workflow_dispatch`). Ou localmente:

```bash
node scripts/update-cambio.js     # reescreve data/cambio.json com a PTAX atual
```

### `data/tarifas.json` — tarifas dos provedores (manual, versionado)

Não existe API pública limpa para todas as tarifas. Este arquivo é a fonte de
credibilidade: editado à mão, com `fonte` e `verificadoEm` por provedor. **Cada
alteração é um commit** — o histórico de tarifas é auditável linha a linha.

Como atualizar uma tarifa:

1. Edite o provedor em `data/tarifas.json`.
2. **Sempre** atualize `verificadoEm` (data ISO `AAAA-MM-DD`) e confira a `fonte`.
3. Rode `node tests/engine.test.js` para garantir que nada quebrou.
4. Commit com mensagem datada (ex.: `tarifas: Wise fee 0,60%→0,55% (wise.com/pricing)`).

Modelos de `fee` suportados (campo `fee.tipo`):

| `tipo`              | usado por | campos                                              | conta |
|---------------------|-----------|-----------------------------------------------------|-------|
| `percent_faixa`     | Wise      | `faixas: [{ateMoeda, pct}]` (`ateMoeda:null` = resto) | fee % sobre o bruto, por faixa do valor |
| `operacional_tier`  | Husky     | `flatMoedaAte: {limite, flatMoeda}`, `pctAcima`      | piso fixo em moeda até o limite, senão % |
| `spread`            | Remessa, banco | `spreadPct`, `tarifaFixaBRL`                    | margem embutida no câmbio + tarifa fixa em R$ |

Campos por provedor: `id`, `nome`, `sub`, `modelo` (`comercial`|`spread`),
`afiliado` (bool), `fee`, `linkAfiliado` (string vazia = botão "em breve";
`null` = sem afiliado), `fonte`, `verificadoEm`. O `iof` no topo do arquivo é
o tributo global (0,0038).

## Afiliados

`afiliado:true` + `linkAfiliado` preenchido → botão "Abrir conta". Link vazio →
botão desabilitado ("em breve"). Sem afiliado (banco) → "conta via gerente / agência".
Sob todo CTA: "link de afiliado · não altera o ranking". A ordem é definida antes de
qualquer link tocar a tela — veja o teste de neutralidade.

## Deploy

GitHub Pages a partir de `/` na branch `main`. Sem passo de build: o que está no
repositório é o que é servido.
