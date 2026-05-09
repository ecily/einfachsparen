process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildSparPdfOfferPrototypeReport,
} = require('../src/services/diagnostics/sparPdfOfferPrototype');

function hasFlag(name, argv = process.argv.slice(2)) {
  return argv.includes(name);
}

function pickExamples(candidates, status, limit = 5) {
  return candidates
    .filter((candidate) => candidate.candidateStatus === status)
    .slice(0, limit)
    .map((candidate) => ({
      sourceKey: candidate.sourceKey,
      pageNumber: candidate.pageNumber,
      titleCandidate: candidate.titleCandidate,
      priceCandidate: candidate.priceCandidate,
      quantityCandidate: candidate.quantityCandidate,
      validityCandidate: candidate.validityCandidate,
      validityEvidenceType: candidate.validityEvidenceType,
      validitySafeForImport: candidate.validitySafeForImport,
      conditionCandidate: candidate.conditionCandidate,
      missingFields: candidate.missingFields,
      rejectionReason: candidate.rejectionReason || '',
    }));
}

function readPreviousComparableMetrics() {
  const reportPath = path.join(__dirname, '..', 'tmp', 'spar-pdf-offers-report.json');

  if (!fs.existsSync(reportPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(reportPath);
    const encoding = raw[0] === 0xff && raw[1] === 0xfe ? 'utf16le' : 'utf8';
    const previous = JSON.parse(raw.toString(encoding).replace(/^\uFEFF/, ''));
    const summary = previous.summary || {};

    return {
      readyCandidates: summary.readyCandidates ?? null,
      needsReviewCandidates: summary.needsReviewCandidates ?? null,
      rejectedCandidates: summary.rejectedCandidates ?? null,
      mixedOfferBlockCount: summary.mixedOfferBlockCount ?? previous.summary?.rejectionReasons?.find?.((item) => item.reason === 'mixed-offer-block')?.count ?? null,
      missingClearTitleCount: summary.missingClearTitleCount ?? previous.summary?.rejectionReasons?.find?.((item) => item.reason === 'missing-clear-title')?.count ?? null,
      missingQuantityUnitCount: summary.missingQuantityUnitCount ?? null,
      missingValidityCount: summary.missingValidityCount ?? null,
      safeValidityCount: summary.safeValidityCount ?? null,
    };
  } catch {
    return null;
  }
}

function renderHumanReport(report) {
  const lines = [];

  lines.push('SPAR/iPaper PDF Offer Prototype');
  lines.push(`checkedAt: ${report.checkedAt}`);
  lines.push(`readOnly: ${report.readOnly}`);
  lines.push(`mutatedCollections: ${JSON.stringify(report.mutatedCollections)}`);
  lines.push('');
  lines.push('PDFs');
  lines.push(`checked: ${report.summary.pdfsChecked}`);
  lines.push(`accessible: ${report.summary.pdfsAccessible}`);
  lines.push(`textLayerAvailable: ${report.summary.textLayerAvailable}`);

  for (const pdf of report.pdfs) {
    lines.push(`- ${pdf.key}: accessible=${pdf.accessible}, textLayer=${pdf.textLayerAvailable}, pages=${pdf.pageCount}, blocks=${pdf.candidateBlocks}, status=${pdf.status || 'n/a'}`);
    if (pdf.reasonIfRejected) {
      lines.push(`  reason: ${pdf.reasonIfRejected}`);
    }
  }

  lines.push('');
  lines.push('Candidates');
  lines.push(`totalCandidateBlocks: ${report.summary.totalCandidateBlocks}`);
  lines.push(`readyCandidates: ${report.summary.readyCandidates}`);
  lines.push(`needsReviewCandidates: ${report.summary.needsReviewCandidates}`);
  lines.push(`rejectedCandidates: ${report.summary.rejectedCandidates}`);
  lines.push(`mixedOfferBlockCount: ${report.summary.mixedOfferBlockCount}`);
  lines.push(`missingClearTitleCount: ${report.summary.missingClearTitleCount}`);
  lines.push(`missingQuantityUnitCount: ${report.summary.missingQuantityUnitCount}`);
  lines.push(`missingValidityCount: ${report.summary.missingValidityCount}`);
  lines.push(`safeValidityCount: ${report.summary.safeValidityCount}`);
  lines.push(`coffeeEvidenceCandidates: ${report.summary.coffeeEvidenceCandidates}`);

  lines.push('');
  lines.push('Ready examples');
  for (const example of pickExamples(report.candidates, 'ready')) {
    lines.push(`- ${example.titleCandidate || '[no title]'} | ${example.priceCandidate ?? '[no price]'} | ${example.quantityCandidate || '[no quantity]'} | ${example.validityCandidate || '[no validity]'} | ${example.validityEvidenceType || 'missing'} | safeValidity=${example.validitySafeForImport} | ${example.conditionCandidate || '[no condition]'}`);
  }

  lines.push('');
  lines.push('Needs review examples');
  for (const example of pickExamples(report.candidates, 'needs_review')) {
    lines.push(`- ${example.titleCandidate || '[no title]'} | ${example.priceCandidate ?? '[no price]'} | missing=${example.missingFields.join(',') || 'none'}`);
  }

  lines.push('');
  lines.push('Top rejection reasons');
  for (const item of report.summary.rejectionReasons.slice(0, 8)) {
    lines.push(`- ${item.reason}: ${item.count}`);
  }

  lines.push('');
  lines.push('Coffee evidence');
  lines.push(`candidateCount: ${report.coffeeEvidence.candidateCount}`);
  lines.push(`terms: ${report.coffeeEvidence.terms.map((term) => term.term).join(', ') || 'none'}`);
  for (const product of report.coffeeEvidence.focusProducts || []) {
    lines.push(`- ${product.label}: detected=${product.candidateDetected}, title=${product.titleClear}, price=${product.priceClear}, quantity=${product.quantityClear}, validity=${product.validityClear}, condition=${product.conditionClear}, status=${product.status}, blocker=${product.mainBlocker || 'none'}`);
  }

  lines.push('');
  lines.push('Readiness');
  lines.push(`canProceedToDevPipelinePrototype: ${report.readinessAssessment.canProceedToDevPipelinePrototype}`);
  lines.push(`blockers: ${report.readinessAssessment.blockers.join(', ') || 'none'}`);
  lines.push(`smallestNextStep: ${report.readinessAssessment.smallestNextStep}`);

  lines.push('');
  lines.push('Recommendations');
  for (const recommendation of report.recommendations) {
    lines.push(`- ${recommendation}`);
  }
  lines.push('');
  lines.push(report.caveat);

  return lines.join('\n');
}

async function run(argv = process.argv.slice(2)) {
  const report = await buildSparPdfOfferPrototypeReport({
    now: new Date(),
    previousComparableMetrics: readPreviousComparableMetrics(),
  });

  if (hasFlag('--json', argv)) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  console.log(renderHumanReport(report));
  return report;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      mutatedCollections: [],
      message: error.message,
      stack: error.stack,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  renderHumanReport,
  pickExamples,
};
