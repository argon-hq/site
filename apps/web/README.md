# Argon — site

Site institucional da Argon: home, cadastro, confirmação e cancelamento da newsletter, e política
de privacidade.

Pacote `web` do monorepo, em `apps/web`.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · ESLint · next-intl

Gerenciador de pacotes: **pnpm**, fixado em `packageManager` no `package.json` da raiz do
monorepo. O lockfile também é único e fica lá — pacotes do workspace não têm o seu.

## Rodando

Da raiz do monorepo, com o Turborepo orquestrando:

```bash
pnpm install
pnpm dev
```

Abre em `https://localhost:3000`. Os mesmos scripts valem para `pnpm build`, `pnpm lint` e
`pnpm check-types`.

O certificado sai do `pnpm certs`, que o `pnpm dev` chama sozinho e refaz quando vence. Como a
autoridade é nossa, o navegador avisa na primeira visita — importar `certs/rootCA.pem` resolve de
vez. O README da raiz conta por que o site local é https.

Para rodar só este pacote, sem passar pelo turbo: `pnpm -C apps/web dev`.

## Site estático

O `pnpm build` gera um site estático em `out/` (`output: "export"`), publicado no S3 atrás do
CloudFront — não há servidor Node. Daí as regras abaixo:

- **Uma pasta por idioma.** Toda rota vive sob `src/app/[locale]/` e é gerada para `pt-BR` e
  `en-US`: `out/pt-BR/newsletter/index.html`, `out/en-US/newsletter/index.html`. Os links
  internos não levam prefixo (`/newsletter`); o CloudFront reescreve a URL para a pasta do idioma
  pelo cookie `locale`, e sem cookie para a do padrão. No `next dev`, rewrites no
  `next.config.ts` fazem o mesmo papel.
- **Preferências em cookie do navegador.** O seletor de idioma grava `locale` e recarrega; o de
  tema grava `theme` e troca o `data-theme` na hora. Nenhum servidor lê os cookies: o tema é
  aplicado antes da pintura por um script inline no `<head>` (`src/theme/script.ts`).
- **A API é chamada do navegador** (`src/lib/api.ts`), na origem de `NEXT_PUBLIC_API_ORIGIN`.
- **Variáveis no build.** `NEXT_PUBLIC_API_ORIGIN` e `WEB_ORIGIN` são lidas no `next build` e
  ficam no HTML e no bundle: cada ambiente tem o seu build.
- **Headers de segurança na CDN.** O export não aplica `headers()`; a CSP e o `Referrer-Policy`
  que o CloudFront manda (`deploy/aws/site_cdn.tf`) estão em `src/lib/security-headers.ts`.

```bash
WEB_ORIGIN=https://lab.argonbusiness.com NEXT_PUBLIC_API_ORIGIN=https://api.lab.argonbusiness.com \
  pnpm -C apps/web build
```

## Testes

Unitários e de componente com Vitest + Testing Library, em `src/**/*.test.{ts,tsx}`, no jsdom.
Os componentes são renderizados com as mensagens reais de `messages/pt-BR.json`, pelo helper em
`src/test/render.tsx`, e as chamadas à API (`src/lib/subscriber.ts`) são testadas com `@/lib/api`
simulado.

```bash
pnpm -C apps/web test        # também roda no `pnpm test` da raiz, pelo turbo
```

Ponta a ponta com Playwright, em `e2e/`. Fica fora do `pnpm test` porque depende do navegador
instalado. O `playwright.config.ts` sobe o site sozinho, em http simples (`dev:http`), com
`NEXT_PUBLIC_API_ORIGIN` apontando para uma porta fechada: o fluxo de cadastro é verificado até a
mensagem de erro da API.

```bash
pnpm -C apps/web exec playwright install chromium   # uma vez
pnpm -C apps/web test:e2e
```

## Rotas

| Rota                      | Descrição                                                                  |
| ------------------------- | -------------------------------------------------------------------------- |
| `/`                       | Home. Vazia por ora — só a marca e um CTA para a newsletter.               |
| `/newsletter`             | Cadastro. Tela cheia, sem cabeçalho nem rodapé.                            |
| `/newsletter/confirm`     | Confirmação. Destino do link do e-mail de inscrição, com o token na query. |
| `/newsletter/confirmed`   | Inscrição confirmada. Destino da confirmação, com o caminho para o início. |
| `/newsletter/unsubscribe` | Cancelamento. Destino do link no rodapé da edição, com o token na query.   |
| `/privacy`                | Placeholder — destino do aceite no cadastro.                               |
| `/page-not-found`         | A página 404, que o CloudFront serve para todo caminho que não existe.     |

Os caminhos ficam sempre em inglês, independente do idioma escolhido.

A 404 leva o texto dos dois idiomas e mostra o do cookie: a resposta de erro do CloudFront não passa
pela função que escolhe a pasta.

## Navegação

O `BackButton` da newsletter só volta no histórico quando existe página anterior _dentro_ do
site. Detectar isso não é trivial: o Next 16 não expõe índice de histórico, `document.referrer`
vem vazio em navegação client-side, e `history.length` conta o `about:blank` da aba — usá-lo
levaria quem abriu o link direto para uma tela branca.

Por isso o `EntryPathTracker`, montado no layout raiz, grava em `sessionStorage` a rota de
entrada. Rota atual igual à de entrada significa que não há para onde voltar, e o botão leva à
home; diferente, volta no histórico.

## Estrutura

```
messages/
├── pt-BR.json
└── en-US.json
src/
├── app/
│   ├── [locale]/         # uma cópia de cada rota por idioma, no build
│   │   ├── (site)/       # páginas com cabeçalho e rodapé
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx              → /
│   │   │   └── privacy/page.tsx      → /privacy
│   │   ├── newsletter/
│   │   │   ├── page.tsx              → /newsletter (fora do grupo: tela cheia)
│   │   │   ├── confirm/page.tsx      → /newsletter/confirm
│   │   │   ├── confirmed/page.tsx    → /newsletter/confirmed
│   │   │   └── unsubscribe/page.tsx  → /newsletter/unsubscribe
│   │   ├── page-not-found/page.tsx   → a 404 do CloudFront
│   │   ├── layout.tsx    # html/body, fontes, script de tema, skip link e metadata base
│   │   └── opengraph-image.tsx       # imagem do preview ao compartilhar o link
│   ├── robots.ts / sitemap.ts        # gerados no build, com o WEB_ORIGIN do ambiente
│   └── globals.css       # tokens de cor e tema do Tailwind
├── components/
│   ├── back-button.tsx
│   ├── brand-mark.tsx    # símbolo e nome ARGON
│   ├── confirm-panel.tsx # lê o token no navegador e confirma
│   ├── entry-path-tracker.tsx
│   ├── flag-icon.tsx     # bandeiras em SVG inline
│   ├── locale-switcher.tsx
│   ├── newsletter-form.tsx
│   ├── option-menu.tsx   # dropdown compartilhado pelos dois seletores
│   ├── site-footer.tsx
│   ├── site-header.tsx
│   ├── unsubscribe-panel.tsx         # lê o token, consulta e cancela, no navegador
│   ├── theme-switcher.tsx
│   └── ui/               # PageHeading e PrimaryCta das telas cheias
├── i18n/
│   ├── config.ts         # idiomas disponíveis, padrão e nome do cookie
│   └── request.ts        # carrega as mensagens do idioma do segmento [locale]
├── theme/
│   ├── config.ts         # temas disponíveis, padrão e nome do cookie
│   ├── script.ts         # aplica o tema do cookie antes da pintura (inline no <head>)
│   └── store.ts          # lê e grava o tema no navegador, para o seletor
├── lib/
│   ├── api.ts            # chamadas à API, do navegador (NEXT_PUBLIC_API_ORIGIN)
│   ├── cookie.ts         # leitura e escrita dos cookies de preferência
│   ├── email.ts          # normalização e validação de formato
│   ├── security-headers.ts           # CSP e Referrer-Policy que a CDN deve mandar
│   ├── site.ts           # origem pública do site (WEB_ORIGIN)
│   ├── subscriber.ts     # cadastro, confirmação, consulta e cancelamento; Zod valida antes
│   └── token.ts          # esquema do token
└── test/
    └── render.tsx        # render com as mensagens reais, para os testes de componente
```

## Cadastro

O `NewsletterForm` valida formato, normaliza o e-mail (minúsculas, sem espaço nas pontas) e tem
honeypot. O envio chama `subscribe` (`src/lib/subscriber.ts`), que faz `POST /subscriber` na API,
direto do navegador, e grava o cadastro como pendente.

A rota é pública na API, sem segredo, com CORS liberado só para a origem do site. A prova de
opt-in exigida pela LGPD — IP e user-agent — a API tira da própria requisição: o navegador não a
manda, porque qualquer um poderia forjá-la.

O retorno é o mesmo para endereço novo, pendente ou já confirmado: a tela não revela quem está
cadastrado. Cadastrar de novo em menos de um minuto não dispara outro e-mail — o link anterior
continua valendo.

O honeypot é só a metade cliente da proteção: sozinho ele não barra nada, e a verificação
precisa existir no servidor.

Variáveis (veja `.env.example`, ambas lidas no build):

| Variável                 | Para quê                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_ORIGIN` | Origem da API, chamada pelo navegador. Local (padrão): `http://localhost:3001`. Entra no `connect-src` da CSP. |
| `WEB_ORIGIN`             | Origem pública do site, para as URLs absolutas de Open Graph, sitemap e robots.                                |

## Confirmação

`/newsletter/confirm?token=…` confirma e leva para `/newsletter/confirmed`. A chamada sai no
`useEffect`, não num link: scanner de cliente de e-mail abre a URL mas não executa JavaScript,
então quem confirma é sempre uma pessoa com o navegador aberto. Link fora do prazo, já usado ou
quebrado cai em telas próprias, cada uma com o caminho de volta para a inscrição.

## Cancelamento

`/newsletter/unsubscribe?token=…` mostra de quem é a inscrição e pede confirmação. Abrir a
página não cancela nada: scanner de link de cliente de e-mail abre toda URL que encontra, e um
GET que cancelasse descadastraria a pessoa sozinho. O cancelamento sai no POST do botão.

A tela oferece "foi engano? reativar", que exige aceite novo da política — reativar é um
cadastro novo, com consentimento novo, e cai na mesma tela de "confirme no seu e-mail".

O token viaja na URL e vazaria no Referer de qualquer link clicado a partir da página. Por isso
a página leva `<meta name="referrer" content="no-referrer">`, e o CloudFront deve mandar também o
header `Referrer-Policy: no-referrer` (valores em `src/lib/security-headers.ts`).

A página é a mesma para todo token: o painel lê o link, consulta a API e mostra o estado
("conferindo o link", o pedido de confirmação ou o link inválido), tudo no navegador.

O cancelamento em um clique dos clientes de e-mail (RFC 8058) não passa por aqui — o cabeçalho
`List-Unsubscribe` aponta direto para a API, que aceita o POST sem segredo porque quem envia é
o servidor do Gmail, não o site.

## Imagens do e-mail

`public/email/*.png` são os ícones do rodapé da newsletter. Cliente de e-mail não aceita SVG nem
caminho relativo, então são PNG e a URL é absoluta. Nos ambientes publicados, a API aponta para o
bucket público, no prefixo do ambiente (`<bucket>/<env>/email/`), para onde o deploy copia esta
pasta antes de atualizar as funções da API; numa máquina local, aponta para o próprio site
(`WEB_ORIGIN` + `/email`). Apagar ou renomear um PNG aqui quebra o e-mail do deploy seguinte — e a
API diz isso no log, ao subir (`EmailAssets`). Quem gera os ícones das redes é o
`pnpm -C apps/api email:icons`.

## Marca

`BrandMark` desenha o símbolo e o nome ARGON; as cores, a Manrope e os raios vêm de
`globals.css`. As decisões e os motivos estão em `design-systems/argon-brand/strategy.md`, e os
arquivos da marca (SVG e PNG) em `public/brand/`, que o deploy também publica no bucket público
(`deploy/aws/README.md`, "Arquivos públicos"). O `public/email/logo.png` é o símbolo em branco com
o ponto lilás, no tamanho dos outros ícones do rodapé do e-mail.

Pendência de design: o painel visual à direita na newsletter ainda não tem arte.
