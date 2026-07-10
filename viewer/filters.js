// ============================================================================
// FILTERS — Zonas de Interesse
// ============================================================================
// Define as zonas disponíveis para o separador "Zonas de Interesse".
// O utilizador ativa/desativa as zonas através de checkboxes no viewer.
// As seleções são guardadas em localStorage.
// ============================================================================

window.__FILTERS__ = {
  // Distritos disponíveis para o scope
  districts: ["Aveiro", "Porto"],

  // Agrupamento de localizações para a UI de checkboxes
  groups: [
    {
      name: "Santa Maria da Feira",
      locations: [
        "Argoncilhe", "Fiães", "Sanguedo", "Lobão", "Lourosa",
        "Nogueira da Regedoura", "Paços de Brandão", "Rio Meão",
        "Santa Maria de Lamas", "São João de Ver", "São Paio de Oleiros",
        "Santa Maria da Feira", "Mozelos",
      ],
    },
    {
      name: "Vila Nova de Gaia",
      locations: [
        "Sandim", "Canedo", "Pedroso", "Seixezelo", "Pedroso e Seixezelo",
        "Arcozelo", "Canelas", "Serezedo", "Olival", "Carvalhos", "Grijó",
        "Sermonde", "Crestuma", "Lever", "Vila Nova de Gaia",
      ],
    },
    {
      name: "Espinho",
      locations: [
        "Anta", "Guetim", "Silvalde", "Vila Maior", "Esmoriz", "Espinho",
      ],
    },
    {
      name: "Outras",
      locations: [
        "Ovar", "Porto", "Aveiro",
      ],
    },
  ],
};
