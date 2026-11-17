import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The Error logs list pages its rows: 5 by default, never more than 50, and
// the total for "showing X–Y of Z" comes back in meta.pagination.
describe('GET /error-logs page size', () => {
  let list;
  let calls;

  function stub(relPath, exports) {
    const resolved = require.resolve(relPath);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }

  beforeAll(() => {
    stub('../../server/services/errorLogService', {
      listErrors: async (args) => {
        calls.push(args);
        return { rows: [], total: 212, page: args.page, limit: args.limit };
      },
      getSummary: async () => ({ unresolved: 212 }),
    });
    stub('../../server/services/escalationService', { getRecentEscalations: async () => [] });
    stub('../../server/utils/activityLog', { logActivity: async () => {} });
    ({ list } = require('../../server/controllers/errorLogsController'));
  });

  beforeEach(() => {
    calls = [];
  });

  async function run(query) {
    let body;
    let error;
    await list({ query }, { json: (b) => { body = b; } }, (e) => { error = e; });
    if (error) throw error;
    return body;
  }

  it('defaults to 5 rows on page 1', async () => {
    const body = await run({});
    expect(calls[0]).toMatchObject({ page: 1, limit: 5, offset: 0 });
    expect(body.meta.pagination).toEqual({ page: 1, limit: 5, total: 212, pages: 43 });
  });

  it.each([5, 25, 50])('accepts a page size of %i', async (limit) => {
    const body = await run({ limit: String(limit), page: '2' });
    expect(calls[0]).toMatchObject({ page: 2, limit, offset: limit });
    expect(body.meta.pagination.pages).toBe(Math.ceil(212 / limit));
  });

  it('clamps a page size above 50 to 50', async () => {
    const body = await run({ limit: '1000' });
    expect(calls[0].limit).toBe(50);
    expect(body.meta.pagination.limit).toBe(50);
  });

  it('falls back to the default for junk limit and page values', async () => {
    await run({ limit: 'abc', page: '-3' });
    expect(calls[0]).toMatchObject({ page: 1, limit: 5, offset: 0 });
  });

  it('passes the severity and resolved filters through with the page', async () => {
    await run({ severity: 'warning', resolved: 'false', limit: '25', page: '3' });
    expect(calls[0]).toMatchObject({ severity: 'warning', resolved: 'false', limit: 25, offset: 50 });
  });

  it('still returns the full summary for the cards', async () => {
    const body = await run({});
    expect(body.meta.summary).toEqual({ unresolved: 212 });
  });
});
