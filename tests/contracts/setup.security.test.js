import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { ERROR_CODES } = require('../../shared/errorCodes.js');

function wipe(prefix) {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(prefix)) delete require.cache[k];
  }
}

describe('setup POST /complete lifecycle', () => {
  let complete;
  let mockIsSetupComplete;
  let mockHasAdmin;
  let mockCompleteSetup;

  beforeEach(() => {
    wipe('/server/controllers/setupController');
    wipe('/server/services/setupService');
    wipe('/server/services/appSettingsService');
    wipe('/server/utils/activityLog');

    mockIsSetupComplete = vi.fn();
    mockHasAdmin = vi.fn();
    mockCompleteSetup = vi.fn();

    require.cache[require.resolve('../../server/services/appSettingsService.js')] = {
      id: require.resolve('../../server/services/appSettingsService.js'),
      filename: require.resolve('../../server/services/appSettingsService.js'),
      loaded: true,
      exports: {
        isSetupComplete: (...a) => mockIsSetupComplete(...a),
        getPublicSettings: vi.fn(),
      },
    };
    require.cache[require.resolve('../../server/services/setupService.js')] = {
      id: require.resolve('../../server/services/setupService.js'),
      filename: require.resolve('../../server/services/setupService.js'),
      loaded: true,
      exports: {
        hasAdminUser: (...a) => mockHasAdmin(...a),
        completeSetup: (...a) => mockCompleteSetup(...a),
      },
    };
    require.cache[require.resolve('../../server/utils/activityLog.js')] = {
      id: require.resolve('../../server/utils/activityLog.js'),
      filename: require.resolve('../../server/utils/activityLog.js'),
      loaded: true,
      exports: { logActivity: vi.fn().mockResolvedValue(null) },
    };

    ({ complete } = require('../../server/controllers/setupController.js'));
  });

  const validBody = {
    store: {
      store_name: 'Shop',
      store_address: '1 Street',
      store_phone: '0500000000',
    },
    vat: { vat_enabled: true, vat_rate: 5 },
    network: { mode: 'server' },
    admin: { full_name: 'Owner', username: 'admin', password: 'secret1' },
  };

  function run(body) {
    return new Promise((resolve) => {
      const req = { body };
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ status: this.statusCode || 200, body: payload });
        },
      };
      complete(req, res, (err) => resolve({ err }));
    });
  }

  it('fresh install: Admin payload is accepted when setup is incomplete and no admin exists', async () => {
    mockIsSetupComplete.mockResolvedValue(false);
    mockHasAdmin.mockResolvedValue(false);
    mockCompleteSetup.mockResolvedValue({ store_name: 'Shop' });
    const out = await run(validBody);
    expect(out.err).toBeUndefined();
    expect(out.status).toBe(201);
    expect(mockCompleteSetup).toHaveBeenCalled();
  });

  it('completed setup: repeated complete is 409 BIZ_INVALID_STATE', async () => {
    mockIsSetupComplete.mockResolvedValue(true);
    const out = await run(validBody);
    expect(out.err.code).toBe(ERROR_CODES.BIZ_INVALID_STATE);
    expect(out.err.status).toBe(409);
    expect(mockCompleteSetup).not.toHaveBeenCalled();
  });

  it('incomplete setup with existing Admin: extra admin payload is rejected', async () => {
    mockIsSetupComplete.mockResolvedValue(false);
    mockHasAdmin.mockResolvedValue(true);
    const out = await run(validBody);
    expect(out.err.code).toBe(ERROR_CODES.BIZ_INVALID_STATE);
    expect(mockCompleteSetup).not.toHaveBeenCalled();
  });

  it('fresh install without admin payload is 400', async () => {
    mockIsSetupComplete.mockResolvedValue(false);
    mockHasAdmin.mockResolvedValue(false);
    const { admin, ...rest } = validBody;
    const out = await run(rest);
    expect(out.err.code).toBe(ERROR_CODES.VAL_REQUIRED_FIELD);
  });
});
