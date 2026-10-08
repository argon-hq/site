// The news of a mocked ingestion. Invented on purpose — outlets, companies and numbers — and marked
// as such in every text, so nothing built from it can pass for the real thing. Each story is here
// to exercise one decision of the chain: importance, the window and its edges, the same fact in
// several outlets, a late copy of what was already published, noise, and the ways a feed breaks.
//
// Times are hours before the run's clock, so the fixture works on any day; links carry the day, so
// a lab that runs the mock every morning gets new links every morning and `seen_url` never empties
// the edition.

export const FIXTURE_NOTE = "Texto de exemplo da Argon, usado para testar a esteira; fatos e números são fictícios.";

export type FixtureSourceKey = "diario" | "portal" | "revista" | "agencia" | "offline";

export type Story = {
  key: string;
  source: FixtureSourceKey;
  // Path under the source's domain, without the day; the day is prefixed when the feed is built.
  path: string;
  title: string;
  hoursAgo: number | null; // null: the feed carries no date
  // How the date is written: RFC 822 with offset, ISO without offset (read as São Paulo), or ISO
  // with offset.
  dateStyle?: "rfc" | "iso_local" | "iso";
  category?: string;
  text?: string; // what the feed carries; absent in a sitemap
  full?: boolean; // the text is the whole article
  // A page for the read of ARG-124 and for the bridge to the writing step: its text, or its failure.
  page?: { text: string } | { status: number } | { unreadable: true };
  // How long the mocked writing makes this story's paragraph, to exercise the body limit: below the
  // target, inside the slack, or over the ceiling (rejected twice, so a reserve ficha takes its place).
  // Without it, the paragraph is cut to the target.
  writtenLength?: number;
  expect: string; // what the chain should do with it, for whoever reads the fixture
};

const paragraph = (lead: string) =>
  `${lead} O movimento foi acompanhado por associações do setor, que pediram regras claras de transição e ` +
  `prazos compatíveis com o caixa das empresas menores. Analistas ouvidos avaliam que o efeito aparece ` +
  `primeiro no custo de capital e depois na contratação. ${FIXTURE_NOTE}`;

const fullText = (lead: string) => Array.from({ length: 5 }, () => paragraph(lead)).join(" ");

export const STORIES: readonly Story[] = [
  // --- The same fact in three outlets, two titles alike and one rewritten.
  {
    key: "mei-diario",
    source: "diario",
    path: "/empresas/governo-amplia-limite-do-mei",
    title: "Governo amplia limite do MEI para R$ 150 mil a partir de janeiro",
    hoursAgo: 5,
    text: fullText("O governo federal ampliou o limite de faturamento do MEI para R$ 150 mil a partir de janeiro."),
    full: true,
    writtenLength: 266,
    expect: "ficha, representative of the MEI group (highest trust), cross coverage; paragraph inside the slack",
  },
  {
    key: "mei-portal",
    source: "portal",
    path: "/economia/limite-do-mei-sobe",
    title: "Governo amplia limite do MEI para R$ 150 mil em janeiro",
    hoursAgo: 4,
    page: { text: fullText("O limite do MEI sobe para R$ 150 mil em janeiro, segundo o governo.") },
    expect: "member of the MEI group",
  },
  {
    key: "mei-revista",
    source: "revista",
    path: "/pme/teto-do-microempreendedor",
    title: "Teto do microempreendedor individual passa a R$ 150 mil no ano que vem",
    hoursAgo: 3,
    text: paragraph("O teto do microempreendedor individual passa a R$ 150 mil no ano que vem."),
    expect:
      "rewritten title: the signature does not catch it, so it stands alone and, without the lexicon, below the cutoff",
  },

  // --- Rates in two outlets.
  {
    key: "copom-diario",
    source: "diario",
    path: "/financas/copom-mantem-selic",
    title: "Copom mantém a Selic e crédito segue caro para empresas",
    hoursAgo: 10,
    text: paragraph("O Comitê de Política Monetária manteve a Selic, e o crédito às empresas segue caro."),
    page: { status: 403 },
    expect: "ficha in a group of two; its page is a paywall, so the writing reads the member's",
  },
  {
    key: "copom-agencia",
    source: "agencia",
    path: "/economia/copom-mantem-a-selic",
    title: "Copom mantém a Selic e o crédito às empresas segue caro",
    hoursAgo: 9,
    text: paragraph("O Copom manteve a taxa Selic."),
    page: { text: fullText("O Copom manteve a taxa Selic e sinalizou cautela com a inflação.") },
    expect: "member of the Copom group; link through the redirector, feed in ISO-8859-1; its open page is the fallback",
  },

  // --- Company and small-business news of varied weight.
  {
    key: "resultado",
    source: "portal",
    path: "/negocios/mercadao-sul-lucro",
    title: "Rede fictícia Mercadão Sul tem lucro de R$ 80 milhões no trimestre",
    hoursAgo: 7,
    page: { text: fullText("A rede Mercadão Sul teve lucro de R$ 80 milhões no trimestre.") },
    expect: "ficha: company lexicon, core section, hard data",
  },
  {
    key: "aporte",
    source: "revista",
    path: "/pme/startup-recebe-aporte",
    title: "Startup de logística Entrega Já recebe aporte de R$ 20 milhões",
    hoursAgo: 12,
    dateStyle: "iso_local",
    text: paragraph("A startup de logística Entrega Já recebeu aporte de R$ 20 milhões."),
    page: { status: 403 },
    writtenLength: 240,
    expect:
      "ficha; date without offset read as São Paulo; page closed (paywall) — the bridge falls back to the feed text; paragraph under the target",
  },
  {
    key: "credito",
    source: "diario",
    path: "/empresas/credito-pequenas-empresas",
    title: "Crédito para pequenas empresas cresce 12% no trimestre",
    hoursAgo: 2,
    text: fullText("O crédito concedido a pequenas e médias empresas cresceu 12% no trimestre."),
    full: true,
    writtenLength: 290,
    expect: "ficha, full text in the feed; paragraph over the ceiling, rejected twice — a reserve takes its place",
  },
  {
    key: "tributaria",
    source: "agencia",
    path: "/economia/reforma-tributaria-regulamentacao",
    title: "Regulamentação da reforma tributária entra em consulta pública",
    hoursAgo: 15,
    text: paragraph("A regulamentação da reforma tributária entrou em consulta pública."),
    page: { unreadable: true },
    expect: "ficha; page without readable text — the bridge falls back to the feed summary",
  },
  {
    key: "pergunta",
    source: "revista",
    path: "/pme/vale-a-pena-abrir-pme",
    title: "Vale a pena abrir uma PME em 2026?",
    hoursAgo: 6,
    text: paragraph("Especialistas discutem se vale a pena abrir uma PME em 2026."),
    expect: "question title loses a point; still a ficha on the lexicon",
  },
  {
    key: "curiosidade",
    source: "portal",
    path: "/brasil/feira-de-artesanato",
    title: "Feira de artesanato reúne expositores no fim de semana",
    hoursAgo: 8,
    expect: "below the cutoff: nothing for a business reader",
  },
  {
    key: "rotina",
    source: "portal",
    path: "/mercados/ibovespa-fecha-em-alta",
    title: "Ibovespa fecha em alta de 0,8% puxado por bancos",
    hoursAgo: 11,
    expect: "market routine: below the cutoff",
  },
  {
    key: "juros-sem-efeito",
    source: "portal",
    path: "/economia/juros-futuros-recuam",
    title: "Juros futuros recuam com dados de inflação",
    hoursAgo: 6,
    expect: "market without a named business effect: worth nothing, below the cutoff",
  },
  {
    key: "ia-pme",
    source: "revista",
    path: "/pme/ferramenta-de-ia-para-pequenas-empresas",
    title: "Plataforma de IA para pequenas empresas automatiza cobrança",
    hoursAgo: 7,
    text: paragraph("Uma plataforma de IA passa a automatizar a cobrança de pequenas empresas."),
    expect: "technology applied to business: core section and technology lexicon, a ficha",
  },
  {
    key: "exterior",
    source: "diario",
    path: "/mundo/banco-central-da-australia",
    title: "Banco central da Austrália eleva juros pela segunda vez",
    hoursAgo: 13,
    text: paragraph("O banco central da Austrália elevou os juros."),
    expect: "abroad without Brazil and a peripheral section: below the cutoff despite the lexicon",
  },

  // --- Noise the code drops before any score.
  {
    key: "ao-vivo",
    source: "portal",
    path: "/live/acompanhe-o-mercado",
    title: "Ao vivo: acompanhe o mercado nesta manhã",
    hoursAgo: 1,
    expect: "discarded by section (/live/) and title",
  },
  {
    key: "patrocinado",
    source: "diario",
    path: "/patrocinado/conheca-a-plataforma",
    title: "Conheça a plataforma que simplifica o crédito para empresas",
    hoursAgo: 4,
    text: paragraph("Conteúdo patrocinado."),
    expect: "discarded by section (/patrocinado/)",
  },
  {
    key: "opiniao",
    source: "diario",
    path: "/opiniao/o-futuro-dos-juros",
    title: "O futuro dos juros e o crédito às empresas",
    hoursAgo: 6,
    text: paragraph("Artigo de opinião."),
    expect: "discarded by section (/opiniao/)",
  },
  {
    key: "futebol",
    source: "revista",
    path: "/esportes/final-do-campeonato",
    title: "Final do campeonato de futebol movimenta R$ 30 milhões",
    hoursAgo: 5,
    category: "Esportes",
    text: paragraph("A final do campeonato movimentou a cidade."),
    expect: "discarded by the category rule",
  },
  {
    key: "loteria",
    source: "portal",
    path: "/brasil/resultado-da-loteria",
    title: "Resultado da loteria de hoje",
    hoursAgo: 3,
    expect: "discarded by title noise",
  },

  // --- The window and its edges.
  {
    key: "borda-dentro",
    source: "diario",
    path: "/empresas/imposto-sobre-servicos-borda",
    title: "Prefeituras revisam imposto sobre serviços de pequenas empresas",
    hoursAgo: 23.9,
    text: paragraph("Prefeituras revisam o imposto sobre serviços."),
    expect: "inside the window by minutes on a weekday",
  },
  {
    key: "borda-fora",
    source: "diario",
    path: "/empresas/tarifa-de-energia-borda",
    title: "Agência reguladora aprova nova tarifa de energia para indústrias",
    hoursAgo: 24.1,
    text: paragraph("A agência aprovou nova tarifa de energia."),
    expect: "outside the window by minutes on a weekday; inside on a Monday (48 h)",
  },
  {
    key: "fim-de-semana",
    source: "portal",
    path: "/negocios/demissoes-no-varejo",
    title: "Varejista fictícia anuncia demissões e fecha 40 lojas",
    hoursAgo: 40,
    expect: "outside on a weekday, a ficha on a Monday",
  },
  {
    key: "futuro",
    source: "portal",
    path: "/negocios/fabrica-nova-anunciada",
    title: "Fabricante fictícia de máquinas anuncia fábrica nova no interior",
    hoursAgo: -5,
    expect: "five hours ahead of the clock: a feed with the wrong zone, dropped and counted as future",
  },
  {
    key: "sem-data",
    source: "revista",
    path: "/pme/sem-data",
    title: "Linha de crédito para MEI sem data informada",
    hoursAgo: null,
    text: paragraph("Uma linha de crédito foi anunciada."),
    expect: "no date: dropped and counted",
  },

  // --- A late copy of what an edition already carried.
  {
    key: "atrasada",
    source: "revista",
    path: "/pme/receita-libera-lote-residual",
    title: "Receita libera consulta ao lote residual do Imposto de Renda",
    hoursAgo: 9,
    text: paragraph("A Receita liberou a consulta ao lote residual do Imposto de Renda."),
    expect: "republished: an edition sent yesterday already carried it",
  },
];

// What the newsletter published in the days before the run: the other side of the late copy.
export const PUBLISHED: readonly { path: string; title: string }[] = [
  {
    path: "https://www.diario-ficticio.test/empresas/receita-libera-consulta-lote-residual",
    title: "Receita libera consulta ao lote residual do Imposto de Renda",
  },
];
