import type { EditionInput } from "../types";

// Content from the Figma prototype (node 6:5). Fixed date so the output is reproducible.
export const editionFixture: EditionInput = {
  date: new Date("2026-09-11T10:00:00-03:00"),
  title: "IA nas buscas, salários de dados e captação de startups",
  subject: "IA já responde por 40% das buscas na internet",
  items: [
    {
      category: "Inteligência Artificial",
      headline: "IA generativa já responde por 40% das buscas na internet, diz novo relatório",
      body: "Estudo da consultoria Gartner mostra aceleração do uso de IA em ferramentas de busca e impacto direto no tráfego orgânico.",
      url: "https://example.com/noticias/ia-buscas-internet",
    },
    {
      category: "Mercado de Trabalho",
      headline: "Salários de profissionais de dados crescem 28% em 12 meses no Brasil",
      body: "Levantamento do LinkedIn aponta alta demanda por engenheiros e analistas de dados com experiência em Python e SQL.",
      url: "https://example.com/noticias/salarios-dados-brasil",
    },
    {
      category: "Carreira",
      headline: "Como líderes da Fortune 500 estruturam suas rotinas de aprendizado contínuo",
      body: "Entrevistas com 12 executivos revelam hábitos comuns: leitura diária, podcasts e blocos de tempo protegido para estudo.",
      url: "https://example.com/noticias/lideres-aprendizado",
    },
    {
      category: "Tecnologia",
      headline: "Microsoft anuncia integração total do Copilot ao pacote Office em outubro",
      body: "Recurso estará disponível para todos os assinantes do Microsoft 365 sem custo adicional, prometendo automatizar tarefas repetitivas.",
      url: "https://example.com/noticias/microsoft-copilot-office",
    },
    {
      category: "Empreendedorismo",
      headline: "Startups brasileiras captaram R$ 3,2 bi no primeiro semestre, alta de 18%",
      body: "Fintechs e healthtechs lideram as rodadas, com investidores regionais ganhando protagonismo frente aos fundos internacionais.",
      url: "https://example.com/noticias/startups-captacao-brasil",
    },
  ],
  sender: { name: "Argon", address: "newsletter@argon.com.br", postalAddress: "Porto Alegre, RS, Brasil" },
  unsubscribeUrl: "https://argon.com.br/newsletter/unsubscribe?token=fixture",
  privacyPolicyUrl: "https://argon.com.br/privacy",
  assetBaseUrl: "https://argon.com.br/email",
  social: {
    site: "https://argon.com.br",
    linkedin: "https://www.linkedin.com/company/argon",
    instagram: "https://www.instagram.com/argon",
    youtube: "https://www.youtube.com/@argon",
  },
};
