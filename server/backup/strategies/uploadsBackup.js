const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.tmp']);

function uploadsDir() {
  return process.env.MAHALI_UPLOADS_DIR
    || path.join(process.cwd(), 'uploads');
}

// Zip the entire /uploads directory. Skips OS junk + .tmp files. If the
// directory doesn't exist yet (fresh install with no images), we still emit
// an empty archive so the destination layout is consistent.
async function backupUploads(outputPath, { compressionLevel = 6 } = {}) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const src = uploadsDir();

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
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
    archive.finalize();
  });
}

module.exports = { backupUploads, uploadsDir };
