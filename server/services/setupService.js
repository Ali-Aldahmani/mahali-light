const bcrypt = require('bcrypt');
const { query, withTransaction } = require('../db/postgres');
const appSettingsService = require('./appSettingsService');
const cashService = require('./cashService');

async function hasAdminUser() {
  const { rows } = await query(
    `SELECT u.id FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'Admin'
     LIMIT 1`,
  );
  return rows.length > 0;
}

async function completeSetup(payload) {
  if (await appSettingsService.isSetupComplete()) {
    const err = new Error('Setup has already been completed.');
    err.code = 'SETUP_ALREADY_DONE';
    throw err;
  }

  const {
    store,
    vat,
    network,
    admin,
    cashDrawer,
    bank,
  } = payload;

  return withTransaction(async (client) => {
    await client.query(
      `UPDATE app_settings SET
         store_name = COALESCE($1, store_name),
         store_name_ar = $2,
         store_address = $3,
         store_phone = $4,
         store_email = $5,
         store_trn = $6,
         vat_enabled = COALESCE($7, vat_enabled),
         vat_rate = COALESCE($8, vat_rate),
         vat_number = COALESCE($9, vat_number),
         invoice_footer_note = COALESCE($10, invoice_footer_note),
         invoice_terms = COALESCE($11, invoice_terms),
         updated_at = NOW()
       WHERE id = (SELECT id FROM app_settings LIMIT 1)`,
      [
        store?.store_name,
        store?.store_name_ar || null,
        store?.store_address,
        store?.store_phone,
        store?.store_email || null,
        store?.store_trn || vat?.vat_number,
        vat?.vat_enabled,
        vat?.vat_rate,
        vat?.vat_number || store?.store_trn,
        store?.invoice_footer_note,
        store?.invoice_terms,
      ],
    );

    let adminUserId = null;
    const adminExists = await hasAdminUser();

    if (!adminExists && admin) {
      const { rows: roleRows } = await client.query(
        `SELECT id FROM roles WHERE name = 'Admin' LIMIT 1`,
      );
      if (!roleRows.length) throw new Error('Admin role not found — run database seed.');

      const { rows: empRows } = await client.query(
        `INSERT INTO employees (name, phone, email, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING id`,
        [admin.full_name, store?.store_phone || null, store?.store_email || null],
      );

      const hash = await bcrypt.hash(admin.password, 10);
      const { rows: userRows } = await client.query(
        `INSERT INTO users (username, password_hash, role_id, employee_id, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [admin.username, hash, roleRows[0].id, empRows[0].id],
      );
      adminUserId = userRows[0].id;

      await client.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [adminUserId],
      );
    }

    if (bank?.bank_name && bank?.account_name) {
      await client.query(
        `INSERT INTO bank_accounts
           (account_name, bank_name, account_number, iban, is_active, is_default, current_balance)
         VALUES ($1, $2, $3, $4, true, true, 0)`,
        [
          bank.account_name,
          bank.bank_name,
          bank.account_number || null,
          bank.iban || null,
        ],
      );
    }

    await client.query(
      `UPDATE app_settings
          SET setup_completed = true,
              setup_completed_at = NOW(),
              updated_at = NOW()
        WHERE id = (SELECT id FROM app_settings LIMIT 1)`,
    );

    return {
      adminUserId,
      network,
      cashDrawer,
    };
  }).then(async (result) => {
    // Open cash drawer outside transaction if we have an admin user.
    if (result.adminUserId && cashDrawer?.opening_balance != null) {
      try {
        const employeeId = (
          await query(`SELECT employee_id FROM users WHERE id = $1`, [
            result.adminUserId,
          ])
        ).rows[0]?.employee_id;
        if (employeeId) {
          await cashService.openDrawer({
            openingBalance: Number(cashDrawer.opening_balance) || 0,
            employeeId,
            notes: 'Opening balance from setup wizard',
          });
        }
      } catch (err) {
        console.warn('[setup] cash drawer open failed', err.message);
      }
    }
    return appSettingsService.getSettings();
  });
}

module.exports = { completeSetup, hasAdminUser };
