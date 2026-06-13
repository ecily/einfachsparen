const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  extractSparPdfReference,
} = require('../src/services/crawl/sparOfficialFlyerPdfParser');

const LOCAL_PDF_DIR = process.env.SPAR_KW24_PDF_DIR || 'C:/Users/Nutzer/Downloads';
const LOCAL_PDFS = {
  interspar: path.join(LOCAL_PDF_DIR, 'Download.pdf'),
  spar: path.join(LOCAL_PDF_DIR, 'Download (1).pdf'),
  eurospar: path.join(LOCAL_PDF_DIR, 'Download (2).pdf'),
};
const hasLocalPdfs = Object.values(LOCAL_PDFS).every((file) => fs.existsSync(file));

async function parseLocalPdf(file, sourceRetailerFormat) {
  return extractSparPdfReference({
    pdfBuffer: fs.readFileSync(file),
    sourceRetailerFormat,
    maxPages: 24,
  });
}

function accepted(reference) {
  return reference.candidates.filter((candidate) => !candidate.exclusionReason);
}

function findOffer(offers, titlePattern) {
  return offers.find((offer) => titlePattern.test(`${offer.title || ''} ${offer.brand || ''} ${offer.rawText || ''}`));
}

function assertOffer(offers, titlePattern, { price, quantityPattern }) {
  const offer = findOffer(offers, titlePattern);

  assert.ok(offer, `missing ${titlePattern}`);
  assert.equal(offer.price, price);
  assert.match(offer.quantityText, quantityPattern);
}

test('local SPAR-family KW24 PDFs expose representative current flyer offers', { skip: !hasLocalPdfs }, async () => {
  const interspar = accepted(await parseLocalPdf(LOCAL_PDFS.interspar, 'interspar'));
  const spar = accepted(await parseLocalPdf(LOCAL_PDFS.spar, 'spar'));
  const eurospar = accepted(await parseLocalPdf(LOCAL_PDFS.eurospar, 'eurospar'));

  assertOffer(interspar, /Stiegl Goldbraeu/i, { price: 14.80, quantityPattern: /20 x 0\.5 l/ });
  assertOffer(interspar, /Coca-Cola Limonaden/i, { price: 16.56, quantityPattern: /24 x 0\.33 l/ });
  assertOffer(interspar, /Milka Schokolade/i, { price: 2.66, quantityPattern: /190 g/ });
  assertOffer(interspar, /Lotus Biscoff/i, { price: 1.32, quantityPattern: /150 g/ });
  assertOffer(interspar, /Bio-Salzstangerl/i, { price: 0.49, quantityPattern: /1 Stueck/ });
  assertOffer(interspar, /S-BUDGET Lachsfilet/i, { price: 19.90, quantityPattern: /1 kg/ });
  assertOffer(interspar, /S-BUDGET Leberkaese/i, { price: 3.99, quantityPattern: /500 g/ });
  assertOffer(interspar, /S-BUDGET Bernerwuerstl/i, { price: 7.99, quantityPattern: /1 kg/ });

  assertOffer(spar, /SPAR Wassermelone kernarm/i, { price: 1.00, quantityPattern: /1 kg/ });
  assertOffer(spar, /Recheis Goldmarke/i, { price: 1.49, quantityPattern: /400-500 g/ });
  assertOffer(spar, /DESPAR Olio/i, { price: 5.99, quantityPattern: /1 l/ });
  assertOffer(spar, /Ben's Original/i, { price: 3.14, quantityPattern: /1 kg/ });
  assertOffer(spar, /DESPAR Pasta/i, { price: 0.74, quantityPattern: /500 g/ });
  assertOffer(spar, /SPAR natives Olivenoel/i, { price: 3.49, quantityPattern: /0\.5 l/ });
  assertOffer(spar, /Hendl Filetschnitzerl/i, { price: 4.99, quantityPattern: /400 g/ });
  assertOffer(spar, /Gulasch- oder Kochfleisch/i, { price: 11.99, quantityPattern: /1 kg/ });
  assertOffer(spar, /Appenzeller/i, { price: 2.99, quantityPattern: /100 g/ });
  assertOffer(spar, /Schaerdinger Mozzarella/i, { price: 0.79, quantityPattern: /125 g/ });
  assertOffer(spar, /Ariel Pulver/i, { price: 19.99, quantityPattern: /82-111 WG/ });
  assertOffer(spar, /Axe Duschgel/i, { price: 1.92, quantityPattern: /250 ml/ });
  assertOffer(spar, /Zewa Toilettenpapier/i, { price: 6.79, quantityPattern: /18-20 Rollen/ });

  assertOffer(eurospar, /SPAR BBQ Garnelenspiesse/i, { price: 3.99, quantityPattern: /145 g/ });
  assertOffer(eurospar, /SPAR Buttertoast/i, { price: 2.49, quantityPattern: /500 g/ });
  assertOffer(eurospar, /Bona Tafeloel/i, { price: 3.99, quantityPattern: /1\.25 l/ });
  assertOffer(eurospar, /Waterdrop Microdrink/i, { price: 5.99, quantityPattern: /12 Stueck/ });
  assertOffer(eurospar, /Finish Tabs/i, { price: 14.99, quantityPattern: /74-93 Tabs/ });
  assertOffer(eurospar, /Persil Pulver/i, { price: 21.98, quantityPattern: /88-120 WG/ });
  assertOffer(eurospar, /Cosy Toilettenpapier/i, { price: 6.79, quantityPattern: /20 Rollen/ });
  assertOffer(eurospar, /Purina One/i, { price: 24.99, quantityPattern: /40 x 85 g/ });
  assertOffer(eurospar, /Sheba Katzennahrung/i, { price: 25.99, quantityPattern: /40 x 85 g/ });
  assertOffer(eurospar, /Silan Selection/i, { price: 2.49, quantityPattern: /30 Waschgaenge/ });
  assertOffer(eurospar, /Pampers Baby Dry/i, { price: 7.99, quantityPattern: /1 Packung/ });

  assert.equal(findOffer(eurospar, /Goesser Maerzen/i), undefined);
  assert.equal(findOffer(eurospar, /Schweinsfilet/i), undefined);
});
