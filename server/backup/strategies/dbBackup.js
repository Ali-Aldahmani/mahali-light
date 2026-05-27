const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function pgEnv() {
  // pg_dump reads password from PGPASSWORD env. We re-export the same vars
  // the API uses so the backup matches the live database.
  return {
    ...process.env,
    PGPASSWORD: process.env.PGPASSWORD || 'postgres',
  };
}

function pgConnArgs() {
  return [
    '-h', process.env.PGHOST || 'localhost',
    '-p', String(process.env.PGPORT || 5432),
    '-U', process.env.PGUSER || 'postgres',
    '-d', process.env.PGDATABASE || 'mahali_light',
  ];
}

function resolveBinary(name, override) {
  if (override && override.trim()) return override.trim();
  // Allow operator to set MAHALI_PG_BIN_DIR if pg_dump is not on PATH.
  const dir = process.env.MAHALI_PG_BIN_DIR;
  if (dir) {
    const candidate = path.join(
      dir,
      process.platform === 'win32' ? `${name}.exe` : name,
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

// pg_dump --format=custom is the most compatible target for pg_restore.
async function backupDatabase(outputPath, { pgDumpPath = null } = {}) {
  const bin = resolveBinary('pg_dump', pgDumpPath);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const args = [
      ...pgConnArgs(),
      '-F', 'c',
      '-Z', '6',
      '--no-owner',
      '--no-privileges',
      '-f', outputPath,
    ];
    const proc = spawn(bin, args, { env: pgEnv() });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      reject(new Error(`pg_dump could not start: ${err.message}`));
    });
    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim().slice(0, 800)}`));
        return;
      }
      try {
        const stats = await fs.promises.stat(outputPath);
        resolve({ path: outputPath, sizeBytes: stats.size });
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function restoreDatabase(backupPath, { pgRestorePath = null } = {}) {
  const bin = resolveBinary('pg_restore', pgRestorePath);
  if (!fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup file not found.' };
  }
  return new Promise((resolve) => {
    const args = [
      ...pgConnArgs(),
      '-c',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      backupPath,
    ];
    const proc = spawn(bin, args, { env: pgEnv() });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      resolve({ success: false, error: `pg_restore could not start: ${err.message}` });
    });
    proc.on('close', (code) => {
      // pg_restore returns 1 for non-fatal errors (object exists, etc).
      // We treat code <= 1 as success since --clean already drops + recreates.
      if (code === 0 || code === 1) {
        resolve({ success: true, warnings: stderr.trim().slice(0, 800) });
      } else {
        resolve({
          success: false,
          error: `pg_restore exited with code ${code}: ${stderr.trim().slice(0, 800)}`,
        });
      }
    });
  });
}

module.exports = { backupDatabase, restoreDatabase };
