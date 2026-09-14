# Argon — site

Site institucional da Argon. Base inicial criada na [REB-38](https://prometeus.atlassian.net/browse/REB-38)
(épico [REB-37](https://prometeus.atlassian.net/browse/REB-37)): cadastro na newsletter, frontend apenas.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · ESLint · Turborepo · next-intl

O gerenciador de pacotes é o **pnpm**, fixado em `packageManager` no `package.json`.

## Rodando

```bash
pnpm install
pnpm dev
```

Abre em `http://localhost:3000`. Outros scripts: `pnpm build`, `pnpm lint`, `pnpm check-types`.

### Turborepo

Os scripts do `package.json` são os comandos reais — o turbo é o executor, e ele traz cache:

```bash
pnpm turbo run lint check-types build
```

A primeira execução leva alguns segundos; as seguintes, sem mudança no código, saem em
milissegundos (`FULL TURBO`). O cache fica em `.turbo/`, fora do versionamento.

`check-types` declara `dependsOn: ["build"]` porque o `tsc` precisa dos tipos de rota que o
`next build` gera em `.next/types/`. Rodando em paralelo, as duas tarefas disputavam o mesmo
diretório e o type check falhava de forma intermitente.

Uma armadilha para quem for mexer no `package.json`: este é um repositório *single-package*,
então um script chamado `build` que invocasse `turbo run build` entraria em recursão infinita.
Por isso `build` continua sendo `next build`, e o turbo é chamado explicitamente.

## Rotas

| Rota | Descrição |
| --- | --- |
| `/` | Home. Vazia por ora — só a marca e um CTA para a newsletter. |
| `/newsletter` | Cadastro. Tela cheia, sem cabeçalho nem rodapé, conforme o protótipo. |
| `/privacy` | Placeholder. Existe para o aceite do cadastro ter um destino válido. |

## Idiomas

O site tem **pt-BR** (padrão) e **en-US**. As traduções ficam em `messages/`, um JSON por
idioma:

```
messages/
├── pt-BR.json
└── en-US.json
```

O idioma **não aparece na URL** — ele vive num cookie e é trocado pelo `LocaleSwitcher`: um
botão compacto com um globo, no canto superior direito do cabeçalho, que abre a lista de
idiomas com a bandeira à esquerda e o nome à direita.

Ele existe **apenas nas telas que têm cabeçalho** (`/` e `/privacy`). A tela de newsletter é
cheia, sem cabeçalho, e no lugar dele tem um botão de voltar (`BackButton`).

Os caminhos das rotas ficam sempre em inglês, independente do idioma escolhido: `/newsletter`
e `/privacy` são os mesmos nos dois.

As bandeiras são SVG inline em `src/components/flag-icon.tsx`, não emoji — emoji de bandeira
não renderiza no Windows, que mostra as letras do país no lugar.

Para mudar o padrão de quem chega sem preferência salva, altere `defaultLocale` em
`src/i18n/config.ts`. Para adicionar um idioma: crie o JSON em `messages/`, some o código à
lista `locales` no mesmo arquivo, acrescente o rótulo em `localeSwitcher` nos JSONs e desenhe
a bandeira em `flag-icon.tsx` — o mapa de bandeiras é tipado por `Locale`, então esquecer a
última etapa quebra o type check em vez de passar batido.

Duas consequências de tirar o idioma da URL, que valem saber:

1. **As rotas passam a ser renderizadas sob demanda** (`ƒ Dynamic` no build), porque ler o
   cookie impede a geração estática. Para o volume atual de páginas não é problema.
2. **Só um idioma é indexado pelos buscadores**, já que as duas versões moram na mesma URL e
   não há como apontar `hreflang` entre elas. Se o público em inglês virar prioridade de SEO,
   é aqui que a decisão precisa ser revista — aí o idioma teria que ir para a URL.

## Tema

Três opções: **Sistema** (padrão), **Claro** e **Escuro**, no `ThemeSwitcher` ao lado do
seletor de idioma. Como o idioma, a escolha vive num cookie — e por isso o `data-theme` já sai
no HTML do servidor. Não há flash de tema errado nem script bloqueante no `<head>`.

A paleta em `globals.css` usa `light-dark()` com `color-scheme`: cada token declara os dois
valores de uma vez e quem decide qual vale é o `color-scheme`. Sem `data-theme` o valor é
`light dark`, e o sistema operacional manda; com `data-theme`, a escolha do visitante vence.
Trocar de tema não duplica a paleta, e os controles nativos — input, checkbox, barra de
rolagem — acompanham sozinhos.

Os dois seletores só existem nas telas com cabeçalho. A newsletter é tela cheia e segue o que
estiver salvo no cookie.

## Navegação

O `BackButton` da tela de newsletter volta para a página anterior — mas só quando existe uma
*dentro* do site. Descobrir isso não é trivial no App Router: o Next 16 não expõe índice de
histórico, `document.referrer` vem vazio em navegação client-side, e `history.length` conta o
`about:blank` da aba, o que faria o visitante que abriu o link direto cair numa tela branca.

Por isso o `EntryPathTracker`, montado no layout raiz, grava em `sessionStorage` a rota em que
o visitante entrou no site. Se a rota atual for a mesma da entrada, não há para onde voltar e o
botão leva à home; caso contrário, volta no histórico.

## Estrutura

```
src/
├── app/
│   ├── (site)/           # páginas com cabeçalho e rodapé
│   │   ├── layout.tsx
│   │   ├── page.tsx              → /
│   │   └── privacy/page.tsx      → /privacy
│   ├── newsletter/page.tsx       → /newsletter (fora do grupo: tela cheia)
│   ├── layout.tsx        # html/body, fontes e metadata base
│   └── globals.css       # tokens de cor (light/dark) e tema do Tailwind
├── components/
│   ├── back-button.tsx
│   ├── brand-mark.tsx    # placeholder do logo
│   ├── entry-path-tracker.tsx
│   ├── flag-icon.tsx     # bandeiras em SVG inline
│   ├── locale-switcher.tsx
│   ├── option-menu.tsx   # dropdown compartilhado pelos dois seletores
│   ├── theme-switcher.tsx
│   ├── newsletter-form.tsx
│   ├── site-footer.tsx
│   └── site-header.tsx
├── i18n/
│   ├── config.ts         # idiomas disponíveis e padrão
│   ├── locale.ts         # server actions de leitura/escrita do cookie
│   └── request.ts        # carrega as mensagens do idioma atual
├── theme/
│   ├── config.ts         # temas disponíveis e padrão
│   └── theme.ts          # server actions de leitura/escrita do cookie
└── lib/
    └── email.ts          # normalização e validação de formato
```

`NewsletterForm` é isolado de propósito: o critério de aceite pede o formulário também na
home, então basta importá-lo quando a home deixar de ser vazia.

## O que a REB-38 cobre aqui

Feito (frontend): cadastro só com e-mail · erro de formato visível sem apagar o que foi
digitado · tela de "falta confirmar no e-mail" com o prazo de 48h · honeypot contra bots ·
e-mail normalizado (minúsculas, sem espaço nas pontas) antes do envio · aceite explícito da
política de privacidade.

Fora de escopo, para a próxima demanda ([REB-74](https://prometeus.atlassian.net/browse/REB-74),
[REB-75](https://prometeus.atlassian.net/browse/REB-75)): token de confirmação de uso único,
estados do assinante, base de e-mails, rate limit por IP, limite de reenvio e tratamento de
bounce. O ponto exato da troca está marcado com `TODO(REB-74/REB-75)` em `newsletter-form.tsx`.

O honeypot é apenas a metade cliente da proteção — sozinho ele não barra nada. A verificação
precisa acontecer no backend.

## Notas de design

O protótipo de baixa fidelidade define o layout: split screen (conteúdo à esquerda, painel
visual à direita), marca no topo, campo de e-mail e botão lado a lado, texto de apoio abaixo.

Dois placeholders esperando decisão: a Argon ainda não tem logo (`BrandMark` desenha um
quadrado com a inicial) e o painel da direita ainda não tem arte. A cor de destaque em
`globals.css` é provisória, até existir identidade visual.
