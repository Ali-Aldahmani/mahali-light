const fs = require('fs');
const path = require('path');

// drivelist is optional — installation requires native compilation and may
// fail on locked-down hosts. We resolve it lazily and degrade gracefully.
let drivelistImpl = null;
function getDrivelist() {
  if (drivelistImpl !== null) return drivelistImpl;
  try {
    drivelistImpl = require('drivelist');
  } catch (_err) {
    drivelistImpl = false;
  }
  return drivelistImpl;
}

const USB_FOLDER = 'POS-Backups';

async function detectUSB() {
  const dl = getDrivelist();
  if (!dl) return [];
  try {
    const drives = await dl.list();
    return (drives || [])
      .filter((d) => d.isRemovable && !d.isSystem)
      .flatMap((d) => {
        const mountpoints = d.mountpoints || [];
        return mountpoints.map((m) => ({
          device: d.device,
          mountpoint: m.path,
          description: d.description || 'USB drive',
          size: d.size || null,
          isRemovable: d.isRemovable === true,
        }));
      })
      .filter((d) => d.mountpoint);
  } catch (_err) {
    return [];
  }
}

async function save(srcFilePath, backupName, scheduleKey) {
  const drives = await detectUSB();
  if (!drives.length) {
    return { type: 'usb', success: false, error: 'No USB drive detected.' };
  }
  // Pick the first writable drive. If multiple are present the operator can
  // unplug the ones they don't want to receive a backup.
  for (const drive of drives) {
    const dir = path.join(drive.mountpoint, USB_FOLDER, scheduleKey || 'misc');
    const finalPath = path.join(dir, backupName);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.copyFile(srcFilePath, finalPath);
      return {
        type: 'usb',
        success: true,
        path: finalPath,
        device: drive.device,
        mountpoint: drive.mountpoint,
      };
    } catch (err) {
      // try the next drive
      drives[0].error = err.message;
    }
  }
  return {
    type: 'usb',
    success: false,
    error: 'Could not write to any USB drive.',
  };
}

module.exports = { detectUSB, save, USB_FOLDER };
