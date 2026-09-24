const crypto = require('crypto');
const fs = require('fs');
const { pipeline } = require('stream/promises');

// Backup archive encryption (backup_settings.encryption_enabled).
//
// Archives hold the whole database — password hashes, customers, costs,
// every financial record — and are copied to local disk, NAS and USB.
// Format (all fixed-width, so decryption can stream):
//
//   "MAHALIBK" (8) | version (1) | scrypt salt (16) | GCM IV (12)
//   | AES-256-GCM ciphertext | GCM auth tag (16)
//
// The header is bound as AAD, so tampering with any byte fails decryption.
// The key is derived per file from MAHALI_BACKUP_SECRET with a context
// string distinct from the NAS-credential key. Lose the secret and
// encrypted archives are unrecoverable — keep a copy of it off the server.
const MAGIC = Buffer.from('MAHALIBK', 'ascii');
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN;
const KDF_CONTEXT = 'mahali-light-backup-archive-v1';

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function backupSecret() {
  const secret = process.env.MAHALI_BACKUP_SECRET;
  if (!secret) {
    throw codedError(
      'BIZ_BACKUP_ENCRYPTION_KEY_MISSING',
      'Backup encryption is enabled but MAHALI_BACKUP_SECRET is not set.',
    );
  }
  return secret;
}

function deriveKey(secret, salt) {
  return crypto.scryptSync(`${KDF_CONTEXT}:${secret}`, salt, 32);
}

async function encryptFile(srcPath, destPath, secret = backupSecret()) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  cipher.setAAD(header);

  await fs.promises.writeFile(destPath, header);
  await pipeline(
    fs.createReadStream(srcPath),
    cipher,
    fs.createWriteStream(destPath, { flags: 'a' }),
  );
  await fs.promises.appendFile(destPath, cipher.getAuthTag());
}

async function isEncryptedFile(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await fh.read(buf, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && buf.equals(MAGIC);
  } finally {
    await fh.close();
  }
}

async function decryptFile(srcPath, destPath, secret = backupSecret()) {
  const { size } = await fs.promises.stat(srcPath);
  if (size < HEADER_LEN + TAG_LEN) {
    throw codedError('BIZ_BACKUP_DECRYPT_FAILED', 'Encrypted backup is truncated.');
  }
  const header = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  const fh = await fs.promises.open(srcPath, 'r');
  try {
    await fh.read(header, 0, HEADER_LEN, 0);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await fh.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw codedError('BIZ_BACKUP_DECRYPT_FAILED', 'Not an encrypted backup archive.');
  }
  const version = header[MAGIC.length];
  if (version !== VERSION) {
    throw codedError('BIZ_BACKUP_DECRYPT_FAILED', `Unsupported backup encryption version ${version}.`);
  }
  const salt = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT_LEN);
  const iv = header.subarray(MAGIC.length + 1 + SALT_LEN, HEADER_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  try {
    await pipeline(
      fs.createReadStream(srcPath, { start: HEADER_LEN, end: size - TAG_LEN - 1 }),
      decipher,
      fs.createWriteStream(destPath),
    );
  } catch (_err) {
    await fs.promises.rm(destPath, { force: true });
    throw codedError(
      'BIZ_BACKUP_DECRYPT_FAILED',
      'Backup could not be decrypted — wrong MAHALI_BACKUP_SECRET, or the file is corrupted.',
    );
  }
}

module.exports = { encryptFile, decryptFile, isEncryptedFile, backupSecret };
