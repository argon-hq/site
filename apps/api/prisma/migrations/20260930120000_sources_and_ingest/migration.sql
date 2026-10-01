-- ARG-123: news ingested by feed and news sitemap, sources in a table, and the ficha a run stores.

-- CreateEnum
CREATE TYPE "feed_kind" AS ENUM ('feed', 'news_sitemap', 'search');

-- CreateEnum
CREATE TYPE "text_kind" AS ENUM ('full', 'summary', 'none');

-- AlterTable
ALTER TABLE "article" ADD COLUMN     "code_score" INTEGER,
ADD COLUMN     "group_members" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "origin" "feed_kind",
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "text_kind" "text_kind",
ADD COLUMN     "title_signature" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
-- seen_url keeps the hash of the canonical link from now on, not the link. The rows written before
-- are dropped instead of converted: they cover three days at most, and a fact seen again is still
-- caught by the title signature against what was published.
DELETE FROM "seen_url";
ALTER TABLE "seen_url" DROP CONSTRAINT "seen_url_pkey",
DROP COLUMN "url",
ADD COLUMN     "url_hash" CHAR(64) NOT NULL,
ADD CONSTRAINT "seen_url_pkey" PRIMARY KEY ("url_hash");

-- CreateTable
CREATE TABLE "source" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "covers" TEXT NOT NULL,
    "trust" SMALLINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "section_rules" JSONB NOT NULL DEFAULT '[]',
    "last_ok_at" TIMESTAMPTZ,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "alerted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_feed" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "kind" "feed_kind" NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_feed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_domain_key" ON "source"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "source_feed_source_id_url_key" ON "source_feed"("source_id", "url");

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_feed" ADD CONSTRAINT "source_feed_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules the schema cannot say.
ALTER TABLE "source" ADD CONSTRAINT "source_trust_range" CHECK ("trust" IN (0, 1));
ALTER TABLE "source" ADD CONSTRAINT "source_failures_non_negative" CHECK ("consecutive_failures" >= 0);
ALTER TABLE "source" ADD CONSTRAINT "source_domain_shape" CHECK ("domain" ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$');
ALTER TABLE "source_feed" ADD CONSTRAINT "source_feed_https" CHECK ("url" LIKE 'https://%');

CREATE TRIGGER source_updated_at BEFORE UPDATE ON "source" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER source_feed_updated_at BEFORE UPDATE ON "source_feed" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What the bridge to the writing step selects from: fichas not yet in an edition, best first.
CREATE INDEX "article_fichas_idx" ON "article"("created_at", "code_score" DESC) WHERE "edition_id" IS NULL;

-- The sources of the survey of 29/09/2026 (ARG-123), until then a constant in rules.ts. Idempotent,
-- so re-running never overwrites what an environment changed through the routes.
INSERT INTO "source" ("domain", "name", "covers", "trust", "active", "section_rules") VALUES
  ('agenciabrasil.ebc.com.br', 'Agência Brasil', 'indicadores, medidas do governo com efeito em negócios', 1, true, '[{"match": "path", "pattern": "/esportes/", "tier": "discard"}, {"match": "path", "pattern": "/economia/", "tier": "adjacent"}, {"match": "path", "pattern": "/geral/", "tier": "adjacent"}, {"match": "path", "pattern": "/politica/", "tier": "peripheral"}, {"match": "path", "pattern": "/internacional/", "tier": "peripheral"}]'::jsonb),
  ('valor.globo.com', 'Valor Econômico', 'empresas, negócios, finanças', 1, true, '[{"match": "path", "pattern": "/patrocinado/", "tier": "discard"}, {"match": "path", "pattern": "/conteudo-de-marca/", "tier": "discard"}, {"match": "path", "pattern": "/opiniao/", "tier": "discard"}, {"match": "path", "pattern": "/eu-e/", "tier": "discard"}, {"match": "path", "pattern": "/impresso/", "tier": "discard"}, {"match": "path", "pattern": "/politica/coluna/", "tier": "discard"}, {"match": "path", "pattern": "/legislacao/coluna/", "tier": "discard"}, {"match": "path", "pattern": "/financas/coluna/", "tier": "discard"}, {"match": "path", "pattern": "/empresas/coluna/", "tier": "discard"}, {"match": "path", "pattern": "/brasil/coluna/", "tier": "discard"}, {"match": "path", "pattern": "/empresas/", "tier": "core"}, {"match": "path", "pattern": "/legislacao/", "tier": "core"}, {"match": "path", "pattern": "/agronegocios/", "tier": "core"}, {"match": "path", "pattern": "/financas/", "tier": "adjacent"}, {"match": "path", "pattern": "/brasil/", "tier": "adjacent"}, {"match": "path", "pattern": "/carreira/", "tier": "adjacent"}, {"match": "path", "pattern": "/politica/", "tier": "peripheral"}, {"match": "path", "pattern": "/mundo/", "tier": "peripheral"}]'::jsonb),
  ('infomoney.com.br', 'InfoMoney', 'negócios, mercado, empreendedorismo', 0, true, '[{"match": "path", "pattern": "/live/", "tier": "discard"}, {"match": "path", "pattern": "/colunistas/", "tier": "discard"}, {"match": "path", "pattern": "/esportes/", "tier": "discard"}, {"match": "path", "pattern": "/web-stories/", "tier": "discard"}, {"match": "path", "pattern": "/patrocinado/", "tier": "discard"}, {"match": "path", "pattern": "/business/", "tier": "core"}, {"match": "path", "pattern": "/negocios/", "tier": "core"}, {"match": "path", "pattern": "/economia/", "tier": "adjacent"}, {"match": "path", "pattern": "/brasil/", "tier": "adjacent"}, {"match": "path", "pattern": "/consumo/", "tier": "adjacent"}, {"match": "path", "pattern": "/minhas-financas/", "tier": "adjacent"}, {"match": "path", "pattern": "/carreira/", "tier": "adjacent"}, {"match": "path", "pattern": "/tecnologia/", "tier": "adjacent"}, {"match": "path", "pattern": "/politica/", "tier": "peripheral"}, {"match": "path", "pattern": "/mundo/", "tier": "peripheral"}]'::jsonb),
  ('exame.com', 'Exame', 'negócios, PME, gestão', 0, true, '[{"match": "path", "pattern": "/esporte/", "tier": "discard"}, {"match": "path", "pattern": "/pop/", "tier": "discard"}, {"match": "path", "pattern": "/colunistas/", "tier": "discard"}, {"match": "path", "pattern": "/negocios/", "tier": "core"}, {"match": "path", "pattern": "/pme/", "tier": "core"}, {"match": "path", "pattern": "/brasil/", "tier": "adjacent"}, {"match": "path", "pattern": "/economia/", "tier": "adjacent"}, {"match": "path", "pattern": "/tecnologia/", "tier": "adjacent"}, {"match": "path", "pattern": "/inteligencia-artificial/", "tier": "adjacent"}, {"match": "path", "pattern": "/carreira/", "tier": "adjacent"}, {"match": "path", "pattern": "/mundo/", "tier": "peripheral"}]'::jsonb),
  ('folha.uol.com.br', 'Folha Mercado', 'mercado, empresas', 1, true, '[{"match": "host", "pattern": "aovivo.", "tier": "discard"}, {"match": "path", "pattern": "/colunas/", "tier": "discard"}, {"match": "path", "pattern": "/blogs/", "tier": "discard"}, {"match": "path", "pattern": "/negocios/", "tier": "core"}, {"match": "path", "pattern": "/mercado/", "tier": "adjacent"}, {"match": "path", "pattern": "/ia/", "tier": "adjacent"}, {"match": "path", "pattern": "/financas/", "tier": "adjacent"}, {"match": "path", "pattern": "/tec/", "tier": "adjacent"}, {"match": "path", "pattern": "/agro/", "tier": "adjacent"}, {"match": "path", "pattern": "/infraestrutura/", "tier": "adjacent"}, {"match": "path", "pattern": "/economia-sustentavel/", "tier": "adjacent"}, {"match": "path", "pattern": "/mundo/", "tier": "peripheral"}, {"match": "path", "pattern": "/poder/", "tier": "peripheral"}]'::jsonb),
  ('forbes.com.br', 'Forbes Brasil', 'negócios, empreendedorismo', 0, true, '[{"match": "path", "pattern": "/forbes-life/", "tier": "discard"}, {"match": "path", "pattern": "/forbeslife/", "tier": "discard"}, {"match": "path", "pattern": "/colunas/", "tier": "discard"}, {"match": "category", "pattern": "Esporte", "tier": "discard"}, {"match": "category", "pattern": "Pop", "tier": "discard"}, {"match": "category", "pattern": "BrandVoice", "tier": "discard"}, {"match": "category", "pattern": "Forbes Sports", "tier": "discard"}, {"match": "path", "pattern": "/forbes-tech/", "tier": "adjacent"}, {"match": "path", "pattern": "/forbes-agro/", "tier": "adjacent"}, {"match": "path", "pattern": "/carreira/", "tier": "adjacent"}]'::jsonb),
  ('forbes.com', 'Forbes', 'entrepreneurs, small business, leadership', 0, false, '[]'::jsonb),
  ('gartner.com', 'Gartner', 'newsroom: tendências e previsões com efeito em negócios', 0, false, '[]'::jsonb)
ON CONFLICT ("domain") DO NOTHING;

INSERT INTO "source_feed" ("source_id", "kind", "url")
SELECT s."id", f."kind"::"feed_kind", f."url"
FROM (VALUES
  ('agenciabrasil.ebc.com.br', 'feed', 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml'),
  ('agenciabrasil.ebc.com.br', 'feed', 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml'),
  ('valor.globo.com', 'news_sitemap', 'https://valor.globo.com/sitemap/valor/news.xml'),
  ('valor.globo.com', 'feed', 'https://valor.globo.com/rss/valor/empresas'),
  ('infomoney.com.br', 'news_sitemap', 'https://www.infomoney.com.br/news-sitemap.xml'),
  ('infomoney.com.br', 'feed', 'https://www.infomoney.com.br/feed/'),
  ('exame.com', 'feed', 'https://exame.com/feed/'),
  ('folha.uol.com.br', 'feed', 'https://feeds.folha.uol.com.br/mercado/rss091.xml'),
  ('forbes.com.br', 'feed', 'https://forbes.com.br/feed/'),
  ('forbes.com', 'feed', 'https://www.forbes.com/entrepreneurs/feed/'),
  ('gartner.com', 'feed', 'https://www.gartner.com/en/newsroom/rss')
) AS f("domain", "kind", "url")
JOIN "source" s ON s."domain" = f."domain"
ON CONFLICT ("source_id", "url") DO NOTHING;
