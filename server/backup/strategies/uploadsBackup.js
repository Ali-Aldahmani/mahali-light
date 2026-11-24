const fs = require('fs');
const path = require('path');
// archiver v8 exports format classes ({ ZipArchive, ... }), not a factory.
const { ZipArchive } = require('archiver');
const { getUploadsRoot } = require('../../utils/paths');

const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.tmp']);

// The folder the app stores uploads in (utils/paths.js), so the backup
// always contains what the app wrote.
function uploadsDir() {
  return getUploadsRoot();
}

// Zip the entire /uploads directory. Skips OS junk + .tmp files. If the
// directory doesn't exist yet (fresh install with no images), we still emit
// an empty archive so the destination layout is consistent.
async function backupUploads(outputPath, { compressionLevel = 6 } = {}) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const src = uploadsDir();

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = new ZipArchive({
      zlib: { level: Math.max(0, Math.min(9, compressionLevel)) },
    });

    output.on('close', async () => {
      try {
        const stats = await fs.promises.stat(outputPath);
        resolve({ path: outputPath, sizeBytes: stats.size });
      } catch (err) {
        reject(err);
      }
    });
    output.on('error', reject);
    archive.on('warning', (w) => {
      // 'ENOENT' is a recoverable warning when a temp file disappears
      // mid-archive — don't fail the job.
      if (w.code !== 'ENOENT') console.warn('[uploadsBackup] warning', w.message);
    });
    archive.on('error', reject);

    archive.pipe(output);
    if (fs.existsSync(src)) {
      archive.glob('**/*', {
        cwd: src,
        ignore: Array.from(SKIP_NAMES),
        dot: false,
      });
    }
    // v8's finalize() returns a promise; its errors are also emitted, so
    // route a rejection to reject() instead of leaving it unhandled.
    archive.finalize().catch(reject);
  });
}

module.exports = { backupUploads, uploadsDir };
