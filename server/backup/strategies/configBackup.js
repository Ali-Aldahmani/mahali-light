const fs = require('fs');
const path = require('path');
// archiver v8 exports format classes ({ ZipArchive, ... }), not a factory.
const { ZipArchive } = require('archiver');

function configDir() {
  return path.join(process.cwd(), 'server', 'config');
}

// Zip server/config/. We never include .env or any *.env file — those carry
// secrets that should stay out of routine backups.
async function backupConfig(outputPath, { compressionLevel = 6 } = {}) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const src = configDir();

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
      if (w.code !== 'ENOENT') console.warn('[configBackup] warning', w.message);
    });
    archive.on('error', reject);

    archive.pipe(output);
    if (fs.existsSync(src)) {
      archive.glob('**/*', {
        cwd: src,
        ignore: ['*.env', '.env*', '*.secret'],
        dot: false,
      });
    }
    // v8's finalize() returns a promise; its errors are also emitted, so
    // route a rejection to reject() instead of leaving it unhandled.
    archive.finalize().catch(reject);
  });
}

module.exports = { backupConfig, configDir };
