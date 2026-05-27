// Background cron jobs should only run on the machine hosting PostgreSQL
// (SERVER mode). Client Electron PCs set mode=client in appConfig.json.
function isServerMode() {
  if (process.env.MAHALI_SERVER_MODE === 'client') return false;
  if (process.env.MAHALI_SERVER_MODE === 'server') return true;
  // Default: when NODE runs the API directly, treat as server.
  return true;
}

module.exports = { isServerMode };
