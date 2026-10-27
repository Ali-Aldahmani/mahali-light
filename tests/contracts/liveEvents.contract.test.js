/**
 * Guard for authentication audit AUTH-04: every broadcast live event goes
 * through emitEvent and its permission map (server/socket/events.js).
 * A new `io.emit(...)` or a send to a role room fails here, and so does an
 * event that has no audience in the map.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../..');
const { EVENT_PERMISSIONS, roomsForEvent, permissionRooms } = require('../../server/socket/events');

function serverFiles(dir = path.join(root, 'server')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return serverFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

describe('live event audiences', () => {
  it('no code broadcasts to everyone or to a role room directly', () => {
    const offenders = [];
    for (const file of serverFiles()) {
      if (rel(file) === 'server/socket/events.js') continue;
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/\b(io|ioInstance)\??\.emit\(/.test(line) || /\.to\(\s*['`]role:/.test(line)) {
          offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('every event sent has an audience', () => {
    const sent = new Set();
    for (const file of serverFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/emitEvent\(\w+, '([a-z_]+)'/g)) sent.add(m[1]);
      for (const m of src.matchAll(/event: '([a-z_]+)'/g)) sent.add(m[1]);
      for (const m of src.matchAll(/emitProductChange\(req, '([a-z_]+)'/g)) sent.add(m[1]);
    }
    expect([...sent].filter((e) => !(e in EVENT_PERMISSIONS))).toEqual([]);
  });

  it('an unknown event is refused rather than sent to everyone', () => {
    expect(() => roomsForEvent('made_up_event')).toThrow(/no audience/);
  });

  it('maps events to permission rooms', () => {
    expect(roomsForEvent('cash_balance_updated')).toEqual(['perm:cash.view', 'perm:*']);
    expect(roomsForEvent('stock_updated')).toEqual(['perm:stock.view', 'perm:product.view', 'perm:*']);
    expect(roomsForEvent('restore_imminent')).toBeNull();
    expect(permissionRooms(['cash.view', 'bank.view'])).toEqual(['perm:cash.view', 'perm:bank.view']);
    expect(permissionRooms(['*'])).toEqual(['perm:*']);
  });
});
