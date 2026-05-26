const { cleanupOldPdfs } = require('../services/pdfService');

// Sweep cached PDF files older than the configured threshold. Defaults to 30
// days as required by Phase 7. Set PDF_CACHE_MAX_AGE_DAYS to override.
const MAX_AGE_DAYS = Number(process.env.PDF_CACHE_MAX_AGE_DAYS || 30);
const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

let timer = null;

async function sweep() {
  try {
    const result = await cleanupOldPdfs({ maxAgeDays: MAX_AGE_DAYS });
    if (result.deleted) {
      console.log(
        `[pdfCleanup] deleted ${result.deleted} cached PDFs older than ${MAX_AGE_DAYS} days.`,
      );
    }
  } catch (err) {
    console.error('[pdfCleanup] sweep failed', err.message);
  }
}

function startPdfCleanupJob() {
  // Delay first run so we don't compete with boot work.
  setTimeout(() => {
    sweep().catch(() => {});
  }, 5 * 60 * 1000);
  if (timer) clearInterval(timer);
  timer = setInterval(sweep, TICK_INTERVAL_MS);
  console.log(
    `[pdfCleanup] scheduled every 6h (max age ${MAX_AGE_DAYS} days).`,
  );
}

module.exports = { startPdfCleanupJob };
