# Monitor de Leilões

Monitor de leilões imobiliários em Portugal. Scraping de várias plataformas, exportação para Excel e um viewer em HTML com filtros. Projeto pessoal para filtrar imóveis na minha zona. Serve o propósito, mas não é nada de elaborado e pode conter falhas.

## Como usar

```bash
npm install
npm start
```

No fim, abre `viewer/index.html` no browser.

## O que acontece quando corro `npm start`

1. **Scrape**: cada scraper vai buscar os imóveis à sua plataforma (timeout de 5 min por scraper; se um travar, salta para o próximo)
2. **Diff**: compara com a execução anterior para encontrar imóveis novos
3. **Excel**: guarda tudo em `data/properties.xlsx`
4. **Viewer**: exporta `viewer/data.js` com os dados para o HTML

## Estrutura

```
src/
├── app.ts                  # entry point
├── config/index.ts         # configuração (user agent, timeouts, etc.)
├── scrapers/               # um scraper por plataforma (19 no total)
├── services/               # orquestração, diff, notificações
├── database/               # leitura/escrita do Excel
└── viewer/export.service.ts # gera viewer/data.js

viewer/                      # frontend estático (abre no browser)
├── index.html
├── app.js                   # lógica do viewer
├── styles.css
├── filters.js               # zonas de interesse (edita aqui)
└── data.js                  # gerado automaticamente

data/                        # Excel + dados
└── properties.xlsx
```

## Configuração

Tudo está em [`src/config/index.ts`](src/config/index.ts). Não há `.env`, edita diretamente:

- `activeScrapers`: lista vazia corre todos. Para correr só alguns: `["onefix", "lcpremium"]`
- `scraperTimeoutMs`: tempo máximo por scraper (default: 300000 = 5 min)
- `requestTimeout`: timeout dos pedidos HTTP (default: 30000)

## Leiloeiras

24 fontes ativas: `onefix`, `bidleiloeira`, `lcpremium`, `leilosoc`, `avaliberica`, `leilostar`, `inlex`, `vleiloes`, `leiloeiradolena`, `solventium`, `exclusivagora`, `leiloatrium`, `cparaiso`, `viaserumos`, `maximovalor`, `caixaimobiliario`, `imoloriente`, `aleiloeiraforense`, `leilosil`, `capital`, `euroestates`, `vamgo`, `leilovalor` e `eleiloes`.

## Zonas de Interesse

As zonas são configuradas no viewer, não no código. Edita [`viewer/filters.js`](viewer/filters.js) para definir distritos e localizações. As seleções do utilizador ficam guardadas no localStorage do browser.

## Scrapers disponíveis

`onefix`, `bidleiloeira`, `lcpremium`, `leilosoc`, `avaliberica`, `leilostar`, `inlex`, `vleiloes`, `leiloeiradolena`, `solventium`, `exclusivagora`, `leiloatrium`, `cparaiso`, `viaserumos`, `maximovalor`, `caixaimobiliario`, `imoloriente`, `aleiloeiraforense`, `leilosil`

Para testar um scraper individual: `npm run test:onefix` (substitui pelo nome).
