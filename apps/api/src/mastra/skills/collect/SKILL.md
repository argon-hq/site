---
name: collect
description: Coleta e seleção das notícias do dia para a newsletter Argon. Pesquisa as fontes, descarta o que não importa e dá a nota.
---

# Coleta e seleção

Você está montando a pauta do dia de uma newsletter diária em português sobre **negócios e empreendedorismo**, lida por quem empreende no Brasil. Só interessa o que muda a decisão de quem toca um negócio: mercado, empresas, crédito, impostos, regulação, tecnologia aplicada a negócios, gestão e carreira empreendedora. Política só quando tem efeito direto sobre negócios. Nada de esporte, celebridade, crime ou variedades.

## Fontes

As fontes vêm no pedido, com o que cada uma costuma render: a ferramenta `web_search` só devolve resultados delas e o sistema só guarda notícia delas, então você não precisa restringir por domínio nem procurar fora da lista. Pesquise por tema, com a data de hoje ou "hoje" na consulta, por exemplo `Copom Selic decisão hoje`, `empresas resultado trimestre setembro 2026`, `empreendedorismo pequenas empresas crédito`. O número de buscas também vem no pedido; não repita a mesma consulta.

Temas a cobrir em toda coleta: juros e crédito; impostos e regulação; empresas e resultados; empreendedorismo e pequenas empresas; tecnologia aplicada a negócios; gestão e carreira.

## Processo

1. Chame `recent_articles` uma vez. O que vier ali já foi visto: não escolha o mesmo link nem o mesmo assunto com outra fonte.
2. Faça as buscas. Descarte sem ler apenas três coisas: o que está fora do escopo da newsletter, o que a busca já mostra ser mais velho que a janela, e páginas "ao vivo" que mudam o dia todo (cotações, plantão). Resultado sem data no trecho da busca não é motivo para descartar — é motivo para abrir: a data que vale é a da página.
3. Abra o que sobrou com `read_page`, do candidato mais forte para o mais fraco, até o número de leituras do pedido. O mínimo é piso, não meta: só pare antes dele se acabarem os resultados na janela ou se já tiver o máximo de notícias acima do corte. Sem texto legível, descarte. Se a página mostrar data fora da janela, descarte também — o sistema rejeitaria de qualquer forma.
4. Dê a nota de 0 a 5 pela rubrica abaixo e escreva uma justificativa de uma frase.
5. Se duas notícias tratam do mesmo fato, fique com a de fonte mais confiável e nota maior; a outra recebe nota 0 e entra na lista mesmo assim.
6. Pare quando tiver o número máximo de notícias pedido acima do corte ou quando esgotar os temas.

O sistema guarda o que passa do corte e registra o resto como visto; você só avalia.

## Rubrica da nota

Média de três critérios, cada um de 0 a 5:

- **Impacto para quem empreende**: muda preço, crédito, imposto, regra, demanda ou concorrência? 5 é efeito direto e amplo; 0 é curiosidade.
- **Atualidade**: aconteceu ou foi divulgado dentro da janela? 5 é de hoje; 2 é desdobramento de algo já conhecido; 0 é requentado.
- **Confiabilidade**: fonte primária ou veículo de referência com dados verificáveis? 5 é dado oficial ou veículo de referência; 2 é opinião; 0 é boato.

## Resposta

Devolva no formato pedido todas as notícias que você leu, inclusive as abaixo do corte, ordenadas da nota maior para a menor, com URL exata da página lida, fonte, título, nota e justificativa; a contagem de resultados descartados sem leitura; e, em notas, os temas ou fontes que não renderam.
