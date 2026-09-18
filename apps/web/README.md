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

Abre em `http://localhost:3000`. Os mesmos scripts valem para `pnpm build`, `pnpm lint` e
`pnpm check-types`.

Para rodar só este pacote, sem passar pelo turbo: `pnpm -C apps/web dev`.

## Rotas

| Rota | Descrição |
| --- | --- |
| `/` | Home. Vazia por ora — só a marca e um CTA para a newsletter. |
| `/newsletter` | Cadastro. Tela cheia, sem cabeçalho nem rodapé. |
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
│   ├── layout.tsx        # html/body, fontes e metadata base
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
│   └── theme-switcher.tsx
├── i18n/
│   ├── config.ts         # idiomas disponíveis e padrão
│   ├── locale.ts         # server actions de leitura/escrita do cookie
│   └── request.ts        # carrega as mensagens do idioma atual
├── theme/
│   ├── config.ts         # temas disponíveis e padrão
│   └── theme.ts          # server actions de leitura/escrita do cookie
├── actions/
│   └── subscribe.ts      # server action do cadastro: chama a API
└── lib/
    └── email.ts          # normalização e validação de formato
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

## Pendências de design

A Argon ainda não tem logo — `BrandMark` desenha um quadrado com a inicial. O painel visual à
direita na newsletter ainda não tem arte. A cor de destaque em `globals.css` é provisória, até
existir identidade visual.
