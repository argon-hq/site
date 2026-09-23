import type { ExtractedArticle } from "../../mastra/schemas/article";
import type { Candidate } from "../collect.schema";
import { editionDate } from "../rules";

// The news a mocked collection finds. Invented on purpose and marked as such in the text, so an
// edition built here can never be mistaken for the real thing — it exists to prove the pipeline
// runs, not to be read.
//
// The link carries the day, because an article is stored by its URL and the URL is unique: with a
// fixed list the first run would save everything and every run after it would find only duplicates,
// leaving the day's edition empty. The domain is one of the allowed sources, so the fixture goes
// through the same allowlist the agent's answers go through; the path is not a real page.
export type FixtureNews = { candidate: Candidate; page: ExtractedArticle };

const NEWS = [
  {
    domain: "valor.globo.com",
    sourceName: "Valor Econômico",
    title: "Crédito para pequenas empresas cresce 12% no trimestre",
    score: 4.6,
    rationale: "Efeito direto no caixa de quem empreende, com número e recorte de porte.",
    text:
      "O crédito concedido a pequenas e médias empresas cresceu 12% no trimestre, segundo levantamento divulgado " +
      "nesta terça-feira. A alta foi puxada por linhas com garantia de recebíveis, que responderam por quase " +
      "metade das novas concessões. Bancos médios ganharam participação no segmento, enquanto as grandes " +
      "instituições mantiveram o ritmo do trimestre anterior. Para o empreendedor, o efeito prático aparece no " +
      "prazo: as operações analisadas saíram de 90 para 120 dias em média. Texto de exemplo da Argon, usado para " +
      "testar a esteira; os dados são fictícios.",
  },
  {
    domain: "infomoney.com.br",
    sourceName: "InfoMoney",
    title: "Copom mantém a Selic e sinaliza espera por dados de inflação",
    score: 4.2,
    rationale: "Decisão de juros muda o custo de capital de qualquer negócio.",
    text:
      "O Comitê de Política Monetária manteve a taxa básica de juros e indicou que a próxima decisão dependerá " +
      "dos próximos dados de inflação. O comunicado repetiu a avaliação de que o cenário externo segue incerto e " +
      "retirou a menção a cortes graduais. Economistas ouvidos passaram a projetar estabilidade até o fim do " +
      "semestre. Para empresas endividadas, a leitura é de custo de capital parado no patamar atual por mais " +
      "tempo. Texto de exemplo da Argon, usado para testar a esteira; os dados são fictícios.",
  },
  {
    domain: "exame.com",
    sourceName: "Exame",
    title: "Varejo adota assistentes de IA no atendimento e corta tempo de resposta",
    score: 3.8,
    rationale: "Tecnologia aplicada com efeito medido em operação de varejo.",
    text:
      "Redes de varejo que adotaram assistentes de inteligência artificial no atendimento relatam queda no tempo " +
      "médio de resposta e aumento na taxa de resolução no primeiro contato. O ganho apareceu em perguntas " +
      "repetitivas sobre prazo de entrega e troca, que concentram a maior parte do volume. As empresas mantiveram " +
      "atendimento humano para casos de reclamação formal. O investimento se pagou em menos de um ano nas " +
      "operações analisadas. Texto de exemplo da Argon, usado para testar a esteira; os dados são fictícios.",
  },
  {
    domain: "agenciabrasil.ebc.com.br",
    sourceName: "Agência Brasil",
    title: "Governo publica regras para compras públicas de pequenas empresas",
    score: 3.1,
    rationale: "Medida de governo com efeito direto em quem vende para o setor público.",
    text:
      "Foi publicada a regulamentação que reserva parte das compras públicas a pequenas empresas. O texto detalha " +
      "os limites por modalidade e o prazo de adequação dos órgãos. Entidades do setor avaliam que a mudança " +
      "amplia o acesso, mas cobram simplificação da habilitação documental. A vigência começa no próximo " +
      "trimestre. Texto de exemplo da Argon, usado para testar a esteira; os dados são fictícios.",
  },
  {
    domain: "folha.uol.com.br",
    sourceName: "Folha Mercado",
    title: "Indústria de alimentos anuncia expansão e novas vagas no interior",
    score: 2.6,
    rationale: "Investimento relevante, mas de efeito regional e sem número consolidado.",
    text:
      "Uma indústria de alimentos anunciou a expansão de sua unidade no interior, com nova linha de produção e " +
      "contratações ao longo do ano. O aporte será feito com recursos próprios e financiamento de longo prazo. A " +
      "empresa afirma que a capacidade instalada cresce cerca de um terço quando a obra terminar. Texto de exemplo " +
      "da Argon, usado para testar a esteira; os dados são fictícios.",
  },
  {
    domain: "forbes.com.br",
    sourceName: "Forbes Brasil",
    title: "Fundo anuncia rodada para startups de logística em estágio inicial",
    score: 2.1,
    rationale: "Interessa a um nicho pequeno e o valor não foi divulgado.",
    text:
      "Um fundo de venture capital anunciou uma nova rodada voltada a startups de logística em estágio inicial. O " +
      "valor total não foi divulgado e a seleção começa no mês que vem. O foco declarado é em operações de última " +
      "milha fora dos grandes centros. Texto de exemplo da Argon, usado para testar a esteira; os dados são " +
      "fictícios.",
  },
] as const;

// Published two hours ago, so every item falls inside the collection window whatever the day.
const PUBLISHED_HOURS_AGO = 2;

export function fixtureNews(now: Date): FixtureNews[] {
  const day = editionDate(now).toISOString().slice(0, 10);
  const publishedAt = new Date(now.getTime() - PUBLISHED_HOURS_AGO * 60 * 60 * 1000).toISOString();

  return NEWS.map((news, index) => {
    const url = `https://${news.domain}/argon-fixture/${day}/${index + 1}`;
    return {
      candidate: {
        url,
        sourceName: news.sourceName,
        title: news.title,
        score: news.score,
        rationale: news.rationale,
      },
      page: {
        canonicalUrl: url,
        originalTitle: news.title,
        extractedText: news.text,
        siteName: news.sourceName,
        publishedAt,
      },
    };
  });
}
