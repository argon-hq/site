# Argon — site

Site institucional da Argon: home, cadastro na newsletter e política de privacidade.

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

## Testes

Unitários e de componente com Vitest + Testing Library, em `src/**/*.test.{ts,tsx}`, no jsdom.
Os componentes são renderizados com as mensagens reais de `messages/pt-BR.json`, pelo helper em
`src/test/render.tsx`, e as server actions são testadas com `@/lib/api` simulado.

```bash
pnpm -C apps/web test        # também roda no `pnpm test` da raiz, pelo turbo
```

Ponta a ponta com Playwright, em `e2e/`. Fica fora do `pnpm test` porque depende do navegador
instalado. O `playwright.config.ts` sobe o site sozinho, em http simples (`dev:http`), com
`API_URL` apontando para uma porta fechada: server action não dá para interceptar do navegador,
então o fluxo de cadastro é verificado até a mensagem de erro da API.

```bash
pnpm -C apps/web exec playwright install chromium   # uma vez
pnpm -C apps/web test:e2e
```

## Rotas

| Rota | Descrição |
| --- | --- |
| `/` | Home. Vazia por ora — só a marca e um CTA para a newsletter. |
| `/newsletter` | Cadastro. Tela cheia, sem cabeçalho nem rodapé. |
| `/newsletter/confirm` | Confirmação. Destino do link do e-mail de inscrição, com o token na query. |
| `/newsletter/unsubscribe` | Cancelamento. Destino do link no rodapé da edição, com o token na query. |
| `/privacy` | Placeholder — destino do aceite no cadastro. |

Os caminhos ficam sempre em inglês, independente do idioma escolhido.

## Navegação

O `BackButton` da newsletter só volta no histórico quando existe página anterior *dentro* do
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
│   ├── (site)/           # páginas com cabeçalho e rodapé
│   │   ├── layout.tsx
│   │   ├── page.tsx              → /
│   │   └── privacy/page.tsx      → /privacy
│   ├── newsletter/page.tsx       → /newsletter (fora do grupo: tela cheia)
│   ├── layout.tsx        # html/body, fontes, skip link e metadata base (Open Graph)
│   ├── opengraph-image.tsx       # imagem do preview ao compartilhar o link
│   ├── robots.ts / sitemap.ts    # gerados por requisição, com o WEB_ORIGIN do ambiente
│   └── globals.css       # tokens de cor e tema do Tailwind
├── components/
│   ├── back-button.tsx
│   ├── brand-mark.tsx    # placeholder do logo
│   ├── entry-path-tracker.tsx
│   ├── flag-icon.tsx     # bandeiras em SVG inline
│   ├── locale-switcher.tsx
│   ├── newsletter-form.tsx
│   ├── option-menu.tsx   # dropdown compartilhado pelos dois seletores
│   ├── site-footer.tsx
│   ├── site-header.tsx
│   ├── unsubscribe-panel.tsx
│   ├── theme-switcher.tsx
│   └── ui/               # PageHeading e PrimaryCta das telas cheias
├── i18n/
│   ├── config.ts         # idiomas disponíveis e padrão
│   ├── locale.ts         # server actions de leitura/escrita do cookie
│   └── request.ts        # carrega as mensagens do idioma atual
├── theme/
│   ├── config.ts         # temas disponíveis e padrão
│   └── theme.ts          # server actions de leitura/escrita do cookie
├── actions/              # server actions; Zod valida a entrada antes de chamar a API
│   ├── subscribe.ts      # cadastro
│   ├── confirm.ts        # confirmação (POST, nunca no GET da página)
│   └── unsubscribe.ts    # cancelamento (só o POST)
├── lib/
│   ├── api.ts            # chamadas à API, sempre do servidor, com o segredo interno
│   ├── email.ts          # normalização e validação de formato
│   ├── site.ts           # origem pública do site (WEB_ORIGIN)
│   ├── token.ts          # esquema do token e normalização do query param
│   └── subscription.ts   # consulta do token de cancelamento (leitura, fora de actions/)
└── test/
    └── render.tsx        # render com as mensagens reais, para os testes de componente
```

## Cadastro

O `NewsletterForm` valida formato, normaliza o e-mail (minúsculas, sem espaço nas pontas) e tem
honeypot. O envio passa pela server action `subscribe`, que chama `POST /subscriber` na API e
grava o cadastro como pendente.

A chamada acontece no servidor: o `INTERNAL_API_SECRET` nunca vai para o navegador. A action
também registra a prova de opt-in exigida pela LGPD — IP (primeiro valor do `x-forwarded-for`,
que o Caddy preenche) e user-agent.

O retorno é o mesmo para endereço novo, pendente ou já confirmado: a tela não revela quem está
cadastrado. Cadastrar de novo em menos de um minuto não dispara outro e-mail — o link anterior
continua valendo.

O honeypot é só a metade cliente da proteção: sozinho ele não barra nada, e a verificação
precisa existir no servidor.

Variáveis (veja `.env.example`, ambas só de servidor):

| Variável | Para quê |
| --- | --- |
| `API_URL` | Base da API. Local: `http://localhost:3001`. Em produção, o serviço no compose. |
| `INTERNAL_API_SECRET` | Header `x-internal-secret` exigido por toda rota da API. |

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

O `Referrer-Policy: no-referrer` da rota está no `next.config.ts`: o token viaja na URL e
vazaria no Referer de qualquer link clicado a partir da página.

O cancelamento em um clique dos clientes de e-mail (RFC 8058) não passa por aqui — o cabeçalho
`List-Unsubscribe` aponta direto para a API, que aceita o POST sem segredo porque quem envia é
o servidor do Gmail, não o site.

## Imagens do e-mail

`public/email/*.png` são os ícones do rodapé da newsletter. Ficam aqui, e não na API, porque quem
serve estático é o site — a API não tem rota pública além de `/health`. Cliente de e-mail não
aceita SVG nem caminho relativo, então são PNG e a URL é absoluta: a API monta cada uma com
`WEB_ORIGIN` + `/email`. Web e API sobem com a mesma tag, então apagar ou renomear um PNG aqui
quebra o e-mail do mesmo deploy — e a API diz isso no log, ao subir (`EmailAssets`). Quem gera é o
`pnpm -C apps/api email:icons`.

## Pendências de design

A Argon ainda não tem logo — `BrandMark` desenha um quadrado com a inicial. O painel visual à
direita na newsletter ainda não tem arte. A cor de destaque em `globals.css` é provisória, até
existir identidade visual.
