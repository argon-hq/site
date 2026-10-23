-- ARG-124: the section rules of the seeded sources follow the newsletter's focus (src/ingest/triage.ts).
-- Technology sections are core, like business; finance, economy and markets are `market`, worth
-- nothing on their own — the title has to name a business effect to score; personal finance is
-- out. Full replacement per domain, so running it again gives the same rows; a source an
-- environment added through the routes is not touched.

UPDATE "source" SET "section_rules" = '[
  {"match": "path", "pattern": "/esportes/", "tier": "discard"},
  {"match": "path", "pattern": "/economia/", "tier": "market"},
  {"match": "path", "pattern": "/geral/", "tier": "neutral"},
  {"match": "path", "pattern": "/politica/", "tier": "peripheral"},
  {"match": "path", "pattern": "/internacional/", "tier": "peripheral"}
]'::jsonb WHERE "domain" = 'agenciabrasil.ebc.com.br';

UPDATE "source" SET "section_rules" = '[
  {"match": "path", "pattern": "/patrocinado/", "tier": "discard"},
  {"match": "path", "pattern": "/conteudo-de-marca/", "tier": "discard"},
  {"match": "path", "pattern": "/opiniao/", "tier": "discard"},
  {"match": "path", "pattern": "/eu-e/", "tier": "discard"},
  {"match": "path", "pattern": "/impresso/", "tier": "discard"},
  {"match": "path", "pattern": "/politica/coluna/", "tier": "discard"},
  {"match": "path", "pattern": "/legislacao/coluna/", "tier": "discard"},
  {"match": "path", "pattern": "/financas/coluna/", "tier": "discard"},
  {"match": "path", "pattern": "/empresas/coluna/", "tier": "discard"},
  {"match": "path", "pattern": "/brasil/coluna/", "tier": "discard"},
  {"match": "path", "pattern": "/empresas/", "tier": "core"},
  {"match": "path", "pattern": "/legislacao/", "tier": "core"},
  {"match": "path", "pattern": "/agronegocios/", "tier": "core"},
  {"match": "path", "pattern": "/financas/", "tier": "market"},
  {"match": "path", "pattern": "/brasil/", "tier": "adjacent"},
  {"match": "path", "pattern": "/carreira/", "tier": "adjacent"},
  {"match": "path", "pattern": "/politica/", "tier": "peripheral"},
  {"match": "path", "pattern": "/mundo/", "tier": "peripheral"}
]'::jsonb WHERE "domain" = 'valor.globo.com';

UPDATE "source" SET "section_rules" = '[
  {"match": "path", "pattern": "/live/", "tier": "discard"},
  {"match": "path", "pattern": "/colunistas/", "tier": "discard"},
  {"match": "path", "pattern": "/esportes/", "tier": "discard"},
  {"match": "path", "pattern": "/web-stories/", "tier": "discard"},
  {"match": "path", "pattern": "/patrocinado/", "tier": "discard"},
  {"match": "path", "pattern": "/minhas-financas/", "tier": "discard"},
  {"match": "path", "pattern": "/onde-investir/", "tier": "discard"},
  {"match": "path", "pattern": "/business/", "tier": "core"},
  {"match": "path", "pattern": "/negocios/", "tier": "core"},
  {"match": "path", "pattern": "/tecnologia/", "tier": "core"},
  {"match": "path", "pattern": "/economia/", "tier": "market"},
  {"match": "path", "pattern": "/mercados/", "tier": "market"},
  {"match": "path", "pattern": "/brasil/", "tier": "adjacent"},
  {"match": "path", "pattern": "/consumo/", "tier": "adjacent"},
  {"match": "path", "pattern": "/carreira/", "tier": "adjacent"},
  {"match": "path", "pattern": "/politica/", "tier": "peripheral"},
  {"match": "path", "pattern": "/mundo/", "tier": "peripheral"}
]'::jsonb WHERE "domain" = 'infomoney.com.br';

UPDATE "source" SET "section_rules" = '[
  {"match": "path", "pattern": "/esporte/", "tier": "discard"},
  {"match": "path", "pattern": "/pop/", "tier": "discard"},
  {"match": "path", "pattern": "/colunistas/", "tier": "discard"},
  {"match": "path", "pattern": "/invest/", "tier": "discard"},
  {"match": "path", "pattern": "/negocios/", "tier": "core"},
  {"match": "path", "pattern": "/pme/", "tier": "core"},
  {"match": "path", "pattern": "/tecnologia/", "tier": "core"},
  {"match": "path", "pattern": "/inteligencia-artificial/", "tier": "core"},
  {"match": "path", "pattern": "/economia/", "tier": "market"},
  {"match": "path", "pattern": "/brasil/", "tier": "adjacent"},
  {"match": "path", "pattern": "/carreira/", "tier": "adjacent"},
  {"match": "path", "pattern": "/mundo/", "tier": "peripheral"}
]'::jsonb WHERE "domain" = 'exame.com';

UPDATE "source" SET "section_rules" = '[
  {"match": "host", "pattern": "aovivo.", "tier": "discard"},
  {"match": "path", "pattern": "/colunas/", "tier": "discard"},
  {"match": "path", "pattern": "/blogs/", "tier": "discard"},
  {"match": "path", "pattern": "/negocios/", "tier": "core"},
  {"match": "path", "pattern": "/ia/", "tier": "core"},
  {"match": "path", "pattern": "/tec/", "tier": "core"},
  {"match": "path", "pattern": "/agro/", "tier": "core"},
  {"match": "path", "pattern": "/mercado/", "tier": "market"},
  {"match": "path", "pattern": "/financas/", "tier": "market"},
  {"match": "path", "pattern": "/infraestrutura/", "tier": "adjacent"},
  {"match": "path", "pattern": "/economia-sustentavel/", "tier": "adjacent"},
  {"match": "path", "pattern": "/mundo/", "tier": "peripheral"},
  {"match": "path", "pattern": "/poder/", "tier": "peripheral"}
]'::jsonb WHERE "domain" = 'folha.uol.com.br';

UPDATE "source" SET "section_rules" = '[
  {"match": "path", "pattern": "/forbes-life/", "tier": "discard"},
  {"match": "path", "pattern": "/forbeslife/", "tier": "discard"},
  {"match": "path", "pattern": "/colunas/", "tier": "discard"},
  {"match": "path", "pattern": "/forbes-money/", "tier": "market"},
  {"match": "category", "pattern": "Esporte", "tier": "discard"},
  {"match": "category", "pattern": "Pop", "tier": "discard"},
  {"match": "category", "pattern": "BrandVoice", "tier": "discard"},
  {"match": "category", "pattern": "Forbes Sports", "tier": "discard"},
  {"match": "category", "pattern": "Forbes Money", "tier": "market"},
  {"match": "path", "pattern": "/forbes-tech/", "tier": "core"},
  {"match": "path", "pattern": "/forbes-agro/", "tier": "core"},
  {"match": "path", "pattern": "/negocios/", "tier": "core"},
  {"match": "path", "pattern": "/carreira/", "tier": "adjacent"}
]'::jsonb WHERE "domain" = 'forbes.com.br';
