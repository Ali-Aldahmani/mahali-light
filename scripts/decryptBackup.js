#!/usr/bin/env node
// Disaster recovery: decrypt an encrypted backup archive (*.tar.gz.enc)
// outside the running app, e.g. on a replacement machine.
//
//   MAHALI_BACKUP_SECRET=... node scripts/decryptBackup.js <in.tar.gz.enc> <out.tar.gz>
//
// Reads MAHALI_BACKUP_SECRET from the environment or the project's .env.
require('dotenv').config();
const { decryptFile } = require('../server/backup/encryption');

async function main() {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error('Usage: node scripts/decryptBackup.js <in.tar.gz.enc> <out.tar.gz>');
    process.exit(2);
  }
  await decryptFile(src, dest);
  console.log(`Decrypted ${src} -> ${dest}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
