const { normalizeTitleForMatch } = require('./sourceEvidence');

const PUBLIC_BASE_URL = 'https://www.kaufklug.at/offer-assets/spar-pdf-crops/';

function normalizeSourceUrlKey(value = '') {
  return String(value || '').toLowerCase();
}

function crop(asset, {
  sourceNeedle,
  candidateId,
  page,
  title,
  price,
  confidence = 0.96,
}) {
  return {
    sourceNeedle,
    candidateId,
    page,
    titleKey: normalizeTitleForMatch(title),
    price: Number(price),
    asset,
    confidence,
  };
}

const STATIC_SPAR_PDF_CROPS = [
  crop('monatssparer-p1-dallmayr-crema-doro.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p1-1',
    page: 1,
    title: "Dallmayr Crema d'Oro ganze Bohne",
    price: 19.99,
  }),
  crop('monatssparer-p1-jacobs-cronat.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p1-2',
    page: 1,
    title: 'Jacobs Cronat Kraeftig oder Mild',
    price: 6.99,
  }),
  crop('monatssparer-p1-cornetto.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p1-3',
    page: 1,
    title: 'Eskimo Cornetto Classico, Erdbeer, Max oder Mini Mix',
    price: 4.49,
  }),
  crop('monatssparer-p1-iglo-geniesserpfanne-lasagne.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p1-4',
    page: 1,
    title: 'Iglo Geniesserpfanne oder Lasagne al Forno',
    price: 4.99,
  }),
  crop('monatssparer-p2-philadelphia.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-1',
    page: 2,
    title: 'Philadelphia Frischkaese',
    price: 1.99,
  }),
  crop('monatssparer-p2-formil-milch.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-2',
    page: 2,
    title: 'Schaerdinger Formil haltbare Vollmilch oder Leichtmilch',
    price: 0.99,
  }),
  crop('monatssparer-p2-loidl-salami-sticks.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-3',
    page: 2,
    title: 'Loidl Salami Sticks oder Salami Pralinen',
    price: 1.52,
  }),
  crop('monatssparer-p2-reiter-kantwurst.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-4',
    page: 2,
    title: 'Kantwurst oder ungarische Salami von Reiter',
    price: 6.49,
  }),
  crop('monatssparer-p2-oelz-rosinenzopf.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-5',
    page: 2,
    title: 'Meisterbaecker Oelz Rosinenzopf',
    price: 3.79,
  }),
  crop('monatssparer-p2-lorenz-pommels.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-6',
    page: 2,
    title: 'Lorenz Pommels',
    price: 0.99,
  }),
  crop('monatssparer-p2-spar-muellsack.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-7',
    page: 2,
    title: 'SPAR Muellsack mit Zugband',
    price: 1.99,
  }),
  crop('monatssparer-p2-milka-kekse.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-8',
    page: 2,
    title: 'Milka Kekse',
    price: 2.46,
  }),
  crop('monatssparer-p2-balsamico.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-9',
    page: 2,
    title: 'Bio-Aceto Balsamico di Modena IGP oder Bio-Condimento Bianco',
    price: 3.79,
  }),
  crop('monatssparer-p2-gelierzucker-xxl.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-10',
    page: 2,
    title: 'Wiener Gelierzucker 1:1 oder 2:1 XXL',
    price: 1.99,
  }),
  crop('monatssparer-p2-gelierzucker-3-1.png', {
    sourceNeedle: '260513-3-monatssparer-kw-20',
    candidateId: 'spar-p2-11',
    page: 2,
    title: 'Wiener Gelierzucker 3:1',
    price: 1.32,
  }),
  crop('grillfolder-p2-meggle-kraeuterbutter.png', {
    sourceNeedle: '260513-2-grillen-kw-20',
    candidateId: 'spar-p2-2',
    page: 2,
    title: 'Meggle Kraeuterbutter',
    price: 1.49,
  }),
  crop('grillfolder-p2-kaesekrainer-bratwurst.png', {
    sourceNeedle: '260513-2-grillen-kw-20',
    candidateId: 'spar-p2-3',
    page: 2,
    title: 'Kaesekrainer, Puten-Kaesekrainer oder Bratwurst',
    price: 3.99,
  }),
  crop('obst-kw23-nektarinen.png', {
    sourceNeedle: '260601-1-obst-gemuse-kw-23',
    candidateId: 'spar-p1-1',
    page: 1,
    title: 'SPAR Nektarinen',
    price: 2.49,
    confidence: 0.94,
  }),
  crop('obst-kw23-kartoffel.png', {
    sourceNeedle: '260601-1-obst-gemuse-kw-23',
    candidateId: 'spar-p1-2',
    page: 1,
    title: 'Bio-Beilagenkartoffel aus Oesterreich',
    price: 1.29,
  }),
  crop('obst-kw23-radieschen.png', {
    sourceNeedle: '260601-1-obst-gemuse-kw-23',
    candidateId: 'spar-p1-3',
    page: 1,
    title: 'Radieschen aus Oesterreich',
    price: 0.89,
    confidence: 0.94,
  }),
  crop('obst-kw23-zitronen.png', {
    sourceNeedle: '260601-1-obst-gemuse-kw-23',
    candidateId: 'spar-p1-4',
    page: 1,
    title: 'Bio-Zitronen zur Hollerbluete',
    price: 1.29,
  }),
  crop('obst-kw23-kiwi-gold.png', {
    sourceNeedle: '260601-1-obst-gemuse-kw-23',
    candidateId: 'spar-p1-5',
    page: 1,
    title: 'ZESPRI Kiwi Gold',
    price: 2.49,
    confidence: 0.93,
  }),
  crop('obst-kw23-spitzpaprika.png', {
    sourceNeedle: '260601-1-obst-gemuse-kw-23',
    candidateId: 'spar-p1-6',
    page: 1,
    title: 'S-BUDGET Spitzpaprika Rot',
    price: 1.99,
  }),
];

function getStaticSparPdfCropForCandidate({ candidate = {}, sourceUrl = '' } = {}) {
  const normalizedSourceUrl = normalizeSourceUrlKey(sourceUrl);
  const candidateTitleKey = normalizeTitleForMatch(candidate.title || '');
  const candidatePrice = Number(candidate.price);
  const candidatePage = Number(candidate.page);

  const match = STATIC_SPAR_PDF_CROPS.find((entry) => (
    normalizedSourceUrl.includes(entry.sourceNeedle)
    && String(candidate.id || '') === entry.candidateId
    && Number(candidatePage) === Number(entry.page)
    && Number.isFinite(candidatePrice)
    && Math.abs(candidatePrice - entry.price) < 0.001
    && candidateTitleKey === entry.titleKey
  ));

  if (!match) return null;

  return {
    imageUrl: `${PUBLIC_BASE_URL}${match.asset}`,
    imageConfidence: match.confidence,
    imageSourceType: 'pdf-static-crop',
    imageEvidence: {
      sourceType: 'spar-official-pdf',
      sourceUrl,
      page: candidate.page,
      candidateId: candidate.id,
      asset: match.asset,
      confidence: match.confidence,
      gates: [
        'static-official-pdf-crop',
        'exact-source-url-fragment',
        'exact-candidate-id',
        'exact-title',
        'exact-price',
        'manual-visual-review',
      ],
    },
  };
}

module.exports = {
  getStaticSparPdfCropForCandidate,
  STATIC_SPAR_PDF_CROPS,
};
