const { query } = require('../db/postgres');
const { ok } = require('../utils/response');
const cashService = require('../services/cashService');
const bankService = require('../services/bankService');

// Build the full snapshot the Treasury overview tab + dashboard hangs off.
async function summary(_req, res, next) {
  try {
    const drawerState = await cashService.getDrawerState();
    const accounts = await bankService.listAccounts({ includeInactive: false });

    const banksTotal = accounts.reduce(
      (acc, a) => acc + Number(a.currentBalance || 0),
      0,
    );

    // Receivables (customers owe us) + Payables (we owe suppliers).
    const { rows: recRows } = await query(
      `SELECT COALESCE(SUM(credit_balance), 0)::numeric AS receivables
         FROM customers WHERE is_active = true AND credit_balance > 0`,
    );
    const { rows: payRows } = await query(
      `SELECT COALESCE(SUM(balance_due), 0)::numeric AS payables
         FROM purchase_orders
        WHERE status NOT IN ('cancelled') AND balance_due > 0`,
    );

    const receivables = Number(recRows[0].receivables);
    const payables = Number(payRows[0].payables);
    const cash = Number(drawerState.currentBalance || 0);
    const totalAssets = round2(cash + banksTotal + receivables);
    const netPosition = round2(totalAssets - payables);

    // Today's flow across cash + bank.
    const today = new Date().toISOString().slice(0, 10);
    const { rows: cashFlow } = await query(
      `SELECT direction, COALESCE(SUM(amount), 0)::numeric AS total,
              COUNT(*)::int AS count
         FROM cash_drawer_transactions
        WHERE timestamp::date = $1
          AND transaction_type NOT IN ('opening','closing')
        GROUP BY direction`,
      [today],
    );
    const { rows: bankFlow } = await query(
      `SELECT direction, COALESCE(SUM(amount), 0)::numeric AS total,
              COUNT(*)::int AS count
         FROM bank_transactions
        WHERE transaction_date = $1
        GROUP BY direction`,
      [today],
    );
    let moneyIn = 0;
    let moneyOut = 0;
    let inCount = 0;
    let outCount = 0;
    for (const r of [...cashFlow, ...bankFlow]) {
      const t = Number(r.total);
      if (r.direction === 'in') {
        moneyIn += t;
        inCount += r.count;
      } else {
        moneyOut += t;
        outCount += r.count;
      }
    }

    // Recent transactions feed (10 newest across both ledgers).
    const { rows: recent } = await query(
      `(
        SELECT 'cash' AS source, t.id, t.transaction_type, t.direction,
               t.amount, t.balance_after, t.reference_type, t.reference_id,
               t.notes, t.timestamp, u.username AS employee_username,
               NULL::text AS bank_name, NULL::uuid AS bank_account_id
          FROM cash_drawer_transactions t
          LEFT JOIN users u ON u.id = t.employee_id
         WHERE t.transaction_type NOT IN ('opening','closing')
      ) UNION ALL (
        SELECT 'bank' AS source, t.id, t.transaction_type, t.direction,
               t.amount, t.balance_after, t.reference_type, t.reference_id,
               t.description AS notes, t.timestamp, u.username AS employee_username,
               b.bank_name, b.id AS bank_account_id
          FROM bank_transactions t
          LEFT JOIN users u ON u.id = t.employee_id
          LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
      )
       ORDER BY timestamp DESC
       LIMIT 12`,
    );

    return ok(res, {
      cash: {
        balance: cash,
        status: drawerState.status,
        sessionId: drawerState.session?.id || null,
        openedAt: drawerState.lastOpenedAt,
        openedByUsername: drawerState.openedByUsername,
      },
      banks: {
        total: round2(banksTotal),
        accounts: accounts.map((a) => ({
          id: a.id,
          bankName: a.bankName,
          accountName: a.accountName,
          currentBalance: a.currentBalance,
          isDefault: a.isDefault,
        })),
      },
      receivables,
      payables,
      totalAssets,
      netPosition,
      today: {
        moneyIn: round2(moneyIn),
        moneyOut: round2(moneyOut),
        net: round2(moneyIn - moneyOut),
        inCount,
        outCount,
      },
      recent: recent.map((r) => ({
        source: r.source,
        id: r.id,
        transactionType: r.transaction_type,
        direction: r.direction,
        amount: Number(r.amount),
        balanceAfter: Number(r.balance_after),
        referenceType: r.reference_type,
        referenceId: r.reference_id,
        notes: r.notes,
        timestamp: r.timestamp,
        employeeUsername: r.employee_username,
        bankName: r.bank_name,
        bankAccountId: r.bank_account_id,
      })),
    });
  } catch (err) {
    next(err);
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { summary };
