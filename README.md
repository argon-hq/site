# Argon — site

Site institucional da Argon. Base inicial criada na [REB-38](https://prometeus.atlassian.net/browse/REB-38)
(épico [REB-37](https://prometeus.atlassian.net/browse/REB-37)): cadastro na newsletter, frontend apenas.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · ESLint · Turborepo

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

Uma armadilha para quem for mexer no `package.json`: este é um repositório *single-package*,
então um script chamado `build` que invocasse `turbo run build` entraria em recursão infinita.
Por isso `build` continua sendo `next build`, e o turbo é chamado explicitamente.

## Rotas

| Rota | Descrição |
| --- | --- |
| `/` | Home. Vazia por ora — só a marca e um CTA para a newsletter. |
| `/newsletter` | Cadastro. Tela cheia, sem cabeçalho nem rodapé, conforme o protótipo. |
| `/privacidade` | Placeholder. Existe para o aceite do cadastro ter um destino válido. |

## Estrutura

```
src/
├── app/
│   ├── (site)/           # páginas com cabeçalho e rodapé
│   │   ├── layout.tsx
│   │   ├── page.tsx              → /
│   │   └── privacidade/page.tsx  → /privacidade
│   ├── newsletter/page.tsx       → /newsletter (fora do grupo: tela cheia)
│   ├── layout.tsx        # html/body, fontes e metadata base
│   └── globals.css       # tokens de cor (light/dark) e tema do Tailwind
├── components/
│   ├── brand-mark.tsx    # placeholder do logo
│   ├── newsletter-form.tsx
│   ├── site-footer.tsx
│   └── site-header.tsx
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
