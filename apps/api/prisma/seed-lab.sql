-- A written edition, without paying for a collection and a writing run. Lets the steps that come
-- after writing be validated in the lab — building, review, sending, the unsubscribe placeholder —
-- on a fixed input, costing no tokens and not depending on what the sources published today.
--
-- Not a migration: it sits loose in prisma/, outside prisma/migrations/, so `migrate deploy` never
-- sees it. It runs by hand, inside the container:
--
--   docker compose run --rm --no-deps api-lab \
--     sh -c './node_modules/.bin/prisma db execute --file prisma/seed-lab.sql'
--
-- No `--schema`: Prisma 7 reads the datasource from prisma.config.ts and rejects the option.
--
-- Running it again leaves exactly the same state: the edition is unique per date, the articles by
-- canonical URL, and whatever was attached to the day's edition and is not from the fixture is
-- detached — a seed that inherits what was already there is not a fixture, it is a surprise.

-- Refuses any database that is not a test one. The image is the same in every environment, and
-- seeding fake news into production would be silent damage.
DO $$
BEGIN
  IF current_database() NOT IN ('argon_lab', 'argon_dev') THEN
    RAISE EXCEPTION 'seed-lab.sql refused: database % is not a test one', current_database();
  END IF;
END $$;

-- The day's edition, on the São Paulo calendar, the way the pipeline opens it. It stays
-- `generating`: that is where the building step starts, and what it moves to `ready`.
INSERT INTO "edition" ("date", "status", "title", "subject")
VALUES (
  (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  'generating',
  'Juros, crédito e IA movem o dia dos negócios',
  'Copom mantém Selic; crédito às PMEs cresce 12%'
)
ON CONFLICT ("date") DO UPDATE
SET "status" = 'generating', "title" = EXCLUDED."title", "subject" = EXCLUDED."subject";

-- Detaches from the day's edition whatever is not from the fixture, so the fixture is always the same.
UPDATE "article"
SET "edition_id" = NULL, "category" = NULL, "headline" = NULL, "body" = NULL
WHERE "edition_id" = (SELECT "id" FROM "edition" WHERE "date" = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  AND "canonical_url" NOT LIKE 'https://%/seed-lab-%';

-- Three articles already written: category, headline and body ready, which is what the building
-- step reads. The extracted text comes along because the review compares what was written with the
-- source. The content is in Portuguese because it is newsletter copy, not code.
WITH edicao AS (
  SELECT "id" FROM "edition" WHERE "date" = (now() AT TIME ZONE 'America/Sao_Paulo')::date
), mock ("canonical_url", "source_name", "original_title", "extracted_text", "category", "headline", "body", "score", "hours_ago") AS (
  VALUES
    ('https://valor.globo.com/financas/noticia/seed-lab-copom-selic.ghtml',
     'Valor Econômico',
     'Copom mantém a Selic em 13,50% ao ano e sinaliza cautela',
     'O Comitê de Política Monetária manteve a taxa básica de juros em 13,50% ao ano, decisão unânime. No comunicado, o Copom afirmou que o cenário exige cautela diante da inflação de serviços.',
     'economy'::"article_category",
     'Copom mantém a Selic em 13,50% e sinaliza cautela com serviços',
     'A decisão foi unânime e o comunicado cita a inflação de serviços como razão para manter o juro parado. Para quem financia capital de giro, o custo segue onde está.',
     4.80, 6),
    ('https://infomoney.com.br/negocios/seed-lab-credito-pme.html',
     'InfoMoney',
     'Crédito para pequenas e médias empresas cresce 12% no trimestre',
     'A carteira de crédito para pequenas e médias empresas cresceu 12% no trimestre, puxada por linhas com garantia. O prazo médio subiu de 18 para 22 meses.',
     'business'::"article_category",
     'Crédito às pequenas e médias empresas cresce 12% no trimestre',
     'As linhas com garantia puxaram a alta e o prazo médio subiu de 18 para 22 meses. Sobra mais fôlego para quem precisa alongar dívida antes de investir.',
     4.10, 11),
    ('https://exame.com/tecnologia/seed-lab-ia-atendimento.html',
     'Exame',
     'Empresas brasileiras dobram uso de IA no atendimento ao cliente',
     'O uso de inteligência artificial no atendimento ao cliente dobrou entre as empresas brasileiras em um ano, segundo levantamento. A adoção é maior no varejo e em serviços financeiros.',
     'technology'::"article_category",
     'Uso de IA no atendimento ao cliente dobra nas empresas brasileiras',
     'Varejo e serviços financeiros lideram a adoção, que dobrou em um ano. O ganho aparece no primeiro contato, não na conversa que precisa de gente.',
     3.60, 19)
)
INSERT INTO "article" (
  "edition_id", "canonical_url", "source_name", "original_title", "extracted_text",
  "published_at", "category", "score", "headline", "body", "created_at"
)
SELECT
  edicao."id", mock."canonical_url", mock."source_name", mock."original_title", mock."extracted_text",
  now() - (mock."hours_ago" || ' hours')::interval, mock."category", mock."score",
  mock."headline", mock."body", now() - (mock."hours_ago" || ' hours')::interval
FROM mock CROSS JOIN edicao
ON CONFLICT ("canonical_url") DO UPDATE
SET "edition_id" = EXCLUDED."edition_id",
    "category" = EXCLUDED."category",
    "score" = EXCLUDED."score",
    "headline" = EXCLUDED."headline",
    "body" = EXCLUDED."body",
    "extracted_text" = EXCLUDED."extracted_text";
