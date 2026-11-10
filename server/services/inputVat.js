const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

const money = (n) => Math.round((Number(n) || 0) * 100 + 1e-9) / 100;

/**
 * The recoverable input VAT inside an amount paid VAT included, from an
 * explicit vatAmount or a rate. Claiming input VAT needs VAT registration
 * (app_settings.vat_enabled); without it any VAT stays part of the expense.
 */
async function resolveInputVat(client, { amount, vatAmount = null, vatRate = null }) {
  const amt = money(amount);
  let vat = 0;
  if (vatAmount != null && vatAmount !== '') vat = money(vatAmount);
  else if (vatRate != null && vatRate !== '' && Number(vatRate) > 0) vat = money((amt * Number(vatRate)) / (100 + Number(vatRate)));
  if (!Number.isFinite(vat) || vat < 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'VAT cannot be negative.', { status: 400, details: { field: 'vatAmount' } });
  }
  if (vat > amt) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'VAT cannot be more than the amount paid.', { status: 400, details: { field: 'vatAmount' } });
  }
  if (vat > 0) {
    const { rows: [s] } = await client.query(`SELECT vat_enabled FROM app_settings ORDER BY updated_at DESC LIMIT 1`);
    if (!s?.vat_enabled) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED,
        'Input VAT can only be claimed when VAT is enabled in Settings.', { status: 400, details: { field: 'vatAmount' } });
    }
  }
  return vat;
}

module.exports = { resolveInputVat };
