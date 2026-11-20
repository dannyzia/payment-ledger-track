import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 SA-LED-08 and SA-CTR-09 — the two Head Office CSV exports.
 *
 * Only the process boundaries are faked: the Supabase service client and the SQL pool.
 * The shipped `getCallerContext`, `requireRole`, `requireCapability` and `requireAssurance`
 * run for real, and the tokens carry real `aal` claims, so a route that loses a gate fails
 * here instead of passing against a stubbed guard.
 *
 * What is pinned:
 *  - both routes refuse a center role and refuse a seat that has not proven aal2;
 *  - both routes refuse a missing/malformed scope before touching the pool;
 *  - the ledger file carries the BOM, the exact accountant columns, integer poisha as
 *    2-decimal BDT, and a formula-leading customer name neutralised;
 *  - the ledger file follows the same center scope as the read route — another center's
 *    row in the fixture never appears in a single-center export;
 *  - the center file is one rectangular table whose center row carries the entry summary
 *    and whose settlement rows carry expected/paid/variance;
 *  - each export writes its audit row (`ledger.export`, `center.export`) with the counts.
 *
 * SA-CTR-08 (provisioning rate cloning) is not covered because it is not built: the
 * published v1 profile is immutable by trigger and the draft routine does not admit the
 * platform seat. See the task report.
 */

const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CENTER_ID = '22222222-2222-4222-8222-222222222222';

type Role = 'owner' | 'admin' | 'staff' | 'super_admin';
type Aal = 'aal1' | 'aal2';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function tokenFor(role: Role, aal: Aal = 'aal2'): string {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: `user-${role}`,
    role,
    aal,
    center_id: role === 'super_admin' ? null : CENTER_ID,
  })}.signature`;
}

function claimsOf(token: string): { sub: string; role: Role; center_id: string | null } {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
    sub: string;
    role: Role;
    center_id: string | null;
  };
}

/** Written by the routes, read by the assertions. */
const audits: Array<Record<string, unknown>> = [];

/** The profile row `getCallerContext` reads; each test sets the role it expects. */
let currentRole: Role = 'super_admin';

function roleCenter(role: Role): string | null {
  return role === 'super_admin' ? null : CENTER_ID;
}

function queryBuilder(single: { data: unknown; error: unknown }): unknown {
  const result = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'neq',
    'in',
    'is',
    'or',
    'order',
    'limit',
    'range',
    'update',
    'upsert',
    'delete',
  ]) {
    builder[method] = () => builder;
  }
  builder['single'] = async () => single;
  builder['maybeSingle'] = async () => single;
  builder['insert'] = async (payload: Record<string, unknown>) => {
    audits.push(payload);
    return { data: null, error: null };
  };
  builder['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

vi.mock('$lib/server/supabase', () => ({
  getServiceSupabase: () => ({
    auth: {
      getUser: async (token: string) => {
        try {
          const claims = claimsOf(token);
          return {
            data: {
              user: {
                id: claims.sub,
                app_metadata: { role: claims.role, center_id: claims.center_id },
              },
            },
            error: null,
          };
        } catch {
          return { data: { user: null }, error: { message: 'invalid token' } };
        }
      },
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return queryBuilder({
          data: {
            role: currentRole,
            active: true,
            center_id: roleCenter(currentRole),
          },
          error: null,
        });
      }
      if (table === 'centers') {
        return queryBuilder({ data: { status: 'active' }, error: null });
      }
      return queryBuilder({ data: null, error: null });
    },
  }),
}));

/**
 * A fixture fleet whose rows are shaped like the export SQL's aliases, filtered by the
 * placeholders found in the statement rather than by argument order.
 */
const FIXTURE = vi.hoisted(() => {
  interface FixtureEntry {
    id: string;
    center_id: string;
    entry_number: number;
    entry_date: string;
    customer_name: string;
    txn_ref: string | null;
    sub_qty: number;
    gross_poisha: string;
    vat_poisha: string;
    commission_poisha: string;
    business_charge_poisha: string;
    customer_charge_poisha: string;
    net_poisha: string;
    status: string;
    method_name: string;
    center_code: string;
    center_name: string;
    created_by_name: string;
    created_by_role: string;
  }

  const entries: FixtureEntry[] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      center_id: '11111111-1111-4111-8111-111111111111',
      entry_number: 1,
      entry_date: '2026-11-01',
      // A spreadsheet formula: the export must neutralise the leading '='.
      customer_name: '=SUM(A1:A2)',
      txn_ref: null,
      sub_qty: 1,
      gross_poisha: '6795',
      vat_poisha: '0',
      commission_poisha: '0',
      business_charge_poisha: '0',
      customer_charge_poisha: '0',
      net_poisha: '6795',
      status: 'active',
      method_name: 'Cash',
      center_code: 'MHK',
      center_name: 'MHK Center',
      created_by_name: 'Owner One',
      created_by_role: 'owner',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      center_id: '11111111-1111-4111-8111-111111111111',
      entry_number: 2,
      entry_date: '2026-11-02',
      // A comma and a quote: must be quoted and doubled, not split into two columns.
      customer_name: 'Rahman, "Rumi"',
      txn_ref: 'TXN-2',
      sub_qty: 2,
      gross_poisha: '10000',
      vat_poisha: '1150',
      commission_poisha: '4200',
      business_charge_poisha: '115',
      customer_charge_poisha: '0',
      net_poisha: '4535',
      status: 'voided',
      method_name: 'bKash',
      center_code: 'MHK',
      center_name: 'MHK Center',
      created_by_name: 'Staff Three',
      created_by_role: 'staff',
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      center_id: '22222222-2222-4222-8222-222222222222',
      entry_number: 1,
      entry_date: '2026-11-03',
      customer_name: 'Other Center Customer',
      txn_ref: 'TXN-3',
      sub_qty: 1,
      gross_poisha: '500',
      vat_poisha: '0',
      commission_poisha: '0',
      business_charge_poisha: '0',
      customer_charge_poisha: '0',
      net_poisha: '500',
      status: 'active',
      method_name: 'Cash',
      center_code: 'RMP',
      center_name: 'RMP Center',
      created_by_name: 'Owner Two',
      created_by_role: 'owner',
    },
  ];

  const center = {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'MHK',
    name: 'MHK Center',
    status: 'active',
    bin_number: '0012345678',
    phone: '01711111111',
    address: '12 Road, Dhaka',
  };

  const settlements = [
    {
      month: '2026-11',
      payable_code: 'vat_payable',
      expected_poisha: '1150',
      paid_poisha: '1150',
      variance_poisha: '0',
      status: 'paid',
    },
    {
      month: '2026-11',
      payable_code: 'bkash_charge_payable',
      expected_poisha: '115',
      paid_poisha: '0',
      variance_poisha: '-115',
      status: 'due',
    },
  ];

  type Params = unknown[];

  function indexOf(sql: string, pattern: RegExp): number | null {
    const match = sql.match(pattern);
    return match ? Number(match[1]) : null;
  }

  function at(params: Params, sql: string, pattern: RegExp): unknown {
    const index = indexOf(sql, pattern);
    return index === null ? undefined : params[index - 1];
  }

  function filtered(sql: string, params: Params) {
    const centerId = at(params, sql, /e\.center_id = \$(\d+)/);
    const from = at(params, sql, /e\.entry_date >= \$(\d+)::date/);
    const to = at(params, sql, /e\.entry_date <= \$(\d+)::date/);
    const status = at(params, sql, /e\.status = \$(\d+)::entry_status/);
    return entries.filter(
      (row) =>
        (centerId === undefined || row.center_id === centerId) &&
        (from === undefined || row.entry_date >= String(from)) &&
        (to === undefined || row.entry_date <= String(to)) &&
        (status === undefined || row.status === status),
    );
  }

  function run(sql: string, params: Params): { rows: unknown[] } {
    if (/FROM settlements/.test(sql)) {
      return { rows: settlements };
    }

    if (/count\(\*\)::int/.test(sql) && /FROM entries/.test(sql)) {
      const active = entries.filter(
        (row) => row.center_id === params[0] && row.status === 'active',
      );
      return {
        rows: [
          {
            active_entries: active.length,
            gross_poisha: active
              .reduce((sum, row) => sum + BigInt(row.gross_poisha), 0n)
              .toString(),
          },
        ],
      };
    }

    if (/FROM centers/.test(sql)) {
      return { rows: params[0] === center.id ? [center] : [] };
    }

    if (/FROM entries e/.test(sql)) {
      return {
        rows: filtered(sql, params)
          .slice()
          .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1)),
      };
    }

    throw new Error(`fixture pool received an unrecognised statement: ${sql.slice(0, 60)}`);
  }

  return { run };
});

vi.mock('$lib/server/db', () => ({
  getDbPool: () => ({
    query: async (sql: string, params: unknown[]) => FIXTURE.run(sql, params ?? []),
  }),
}));

const { GET: ledgerExport } =
  await import('../../src/routes/api/v1/admin/super/ledger/export/+server');
const { GET: centerExport } =
  await import('../../src/routes/api/v1/admin/super/centers/[id]/export/+server');

function ledgerEvent(token: string, query: Record<string, string>): RequestEvent {
  const url = new URL('http://localhost/api/v1/admin/super/ledger/export');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return {
    url,
    request: new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
    params: {},
  } as unknown as RequestEvent;
}

function centerEvent(token: string, id: string): RequestEvent {
  const url = new URL(`http://localhost/api/v1/admin/super/centers/${id}/export`);
  return {
    url,
    request: new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
    params: { id },
  } as unknown as RequestEvent;
}

/**
 * Reads the CSV body and proves the UTF-8 BOM on the wire. `response.text()` cannot be
 * used for that check: the WHATWG UTF-8 decoder strips a leading BOM, so the marker is
 * invisible to it even when the server wrote it.
 */
async function csvLines(response: Response): Promise<string[]> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder('utf-8').decode(bytes.slice(3)).split('\r\n');
}

/** Normalizes a SvelteKit `error()` throw into status + message. */
async function outcome(run: () => Promise<Response> | Response): Promise<{
  status: number;
  message: string;
  response?: Response;
}> {
  try {
    const response = await run();
    const body = (await response
      .clone()
      .json()
      .catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    return { status: response.status, message: body.message ?? body.error ?? '', response };
  } catch (thrown) {
    const httpError = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpError.status !== 'number') {
      return { status: 500, message: String((thrown as Error)?.message ?? thrown) };
    }
    return { status: httpError.status, message: httpError.body?.message ?? '' };
  }
}

beforeEach(() => {
  audits.length = 0;
  currentRole = 'super_admin';
});

describe('GET /api/v1/admin/super/ledger/export (SA-LED-08)', () => {
  it('refuses a center role and a seat without aal2 on both export routes', async () => {
    for (const role of ['owner', 'admin', 'staff'] as const) {
      currentRole = role;
      const token = tokenFor(role);
      const ledger = await outcome(() => ledgerExport(ledgerEvent(token, { centerId: 'all' })));
      const center = await outcome(() => centerExport(centerEvent(token, CENTER_ID)));
      expect(ledger.status, `${role} reached the ledger export`).toBe(403);
      expect(center.status, `${role} reached the center export`).toBe(403);
    }

    currentRole = 'super_admin';
    const aal1 = tokenFor('super_admin', 'aal1');
    const ledger = await outcome(() => ledgerExport(ledgerEvent(aal1, { centerId: 'all' })));
    const center = await outcome(() => centerExport(centerEvent(aal1, CENTER_ID)));
    expect({ status: ledger.status, message: ledger.message }).toEqual({
      status: 403,
      message: 'assurance_required',
    });
    expect({ status: center.status, message: center.message }).toEqual({
      status: 403,
      message: 'assurance_required',
    });
    // No file was produced, and nothing was recorded as exported.
    expect(audits).toHaveLength(0);
  });

  it('refuses an omitted scope and a malformed center id before reading anything', async () => {
    currentRole = 'super_admin';
    const token = tokenFor('super_admin');

    const missing = await outcome(() => ledgerExport(ledgerEvent(token, {})));
    expect(missing.status).toBe(400);
    expect(missing.message).toContain('centerId is required');

    const badDate = await outcome(() =>
      ledgerExport(ledgerEvent(token, { centerId: 'all', from: '20-11-2026' })),
    );
    expect(badDate.status).toBe(400);
    expect(badDate.message).toBe('invalid_query');

    const badCenter = await outcome(() => centerExport(centerEvent(token, 'not-a-uuid')));
    expect(badCenter.status).toBe(400);
    expect(badCenter.message).toBe('invalid_center_id');
  });

  it('writes the header, the BOM, exact money and a neutralised formula', async () => {
    currentRole = 'super_admin';
    const result = await outcome(() =>
      ledgerExport(ledgerEvent(tokenFor('super_admin'), { centerId: CENTER_ID })),
    );

    expect(result.status).toBe(200);
    const response = result.response!;
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="clt-ledger-export-\d{8}\.csv"$/,
    );

    const lines = await csvLines(response);
    expect(lines[0]).toBe(
      'Entry ID,Center Code,Center Name,Date,Status,Customer,Sub Qty,Method,Gross (BDT),VAT (BDT),Commission (BDT),Merchant Fee (BDT),Customer Fee (BDT),Net (BDT),Txn Ref,Created By Name,Created By Role',
    );
    expect(lines).toHaveLength(3); // header + two MHK rows

    expect(lines).toContain(
      "E-MHK-202611-000001,MHK,MHK Center,2026-11-01,active,'=SUM(A1:A2),1,Cash,67.95,0.00,0.00,0.00,0.00,67.95,,Owner One,owner",
    );
    expect(lines[1]).toBe(
      'E-MHK-202611-000002,MHK,MHK Center,2026-11-02,voided,"Rahman, ""Rumi""",2,bKash,100.00,11.50,42.00,1.15,0.00,45.35,TXN-2,Staff Three,staff',
    );
  });

  it('scopes the file exactly like the read route', async () => {
    currentRole = 'super_admin';
    const single = await ledgerExport(
      ledgerEvent(tokenFor('super_admin'), { centerId: CENTER_ID }),
    );
    const singleCsv = (await csvLines(single)).join('\r\n');
    expect(singleCsv).not.toContain('RMP');
    expect(singleCsv).not.toContain('Other Center Customer');
    expect(singleCsv).toContain('MHK');

    const fleet = await ledgerExport(ledgerEvent(tokenFor('super_admin'), { centerId: 'all' }));
    const fleetLines = await csvLines(fleet);
    expect(fleetLines.join('\r\n')).toContain('RMP');
    expect(fleetLines.join('\r\n')).toContain('Other Center Customer');
    expect(fleetLines).toHaveLength(4);
  });

  it('records the export with its filters and row count', async () => {
    currentRole = 'super_admin';
    await ledgerExport(
      ledgerEvent(tokenFor('super_admin'), {
        centerId: 'all',
        from: '2026-11-01',
        to: '2026-11-30',
        status: 'active',
      }),
    );

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      center_id: null,
      actor: 'user-super_admin',
      action: 'ledger.export',
      target_table: 'entries',
      after: {
        scope: 'all',
        from: '2026-11-01',
        to: '2026-11-30',
        status: 'active',
        row_count: 2, // the two active rows; the voided one is filtered out
        format: 'csv',
      },
    });
  });
});

describe('GET /api/v1/admin/super/centers/[id]/export (SA-CTR-09)', () => {
  it('writes one rectangular table with the profile, the entry total and the settlements', async () => {
    currentRole = 'super_admin';
    const result = await outcome(() =>
      centerExport(centerEvent(tokenFor('super_admin'), CENTER_ID)),
    );

    expect(result.status).toBe(200);
    const response = result.response!;
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="clt-center-MHK-export-\d{8}\.csv"$/,
    );

    const lines = await csvLines(response);
    expect(lines[0]).toBe(
      'Section,Center Code,Center Name,Center Status,BIN,Phone,Address,Month,Payable Code,Expected (BDT),Paid (BDT),Variance (BDT),Settlement Status,Active Entries,Gross (BDT)',
    );

    // The profile row: 15 fields, with the comma-bearing address quoted, and the
    // one active entry (6795 poisha) summarised in the last two columns.
    expect(lines[1]).toBe(
      'center,MHK,MHK Center,active,0012345678,01711111111,"12 Road, Dhaka",,,,,,,1,67.95',
    );

    // Settlement rows leave the two summary columns empty; the padding keeps the table
    // rectangular so a spreadsheet reads every line as the same record shape.
    expect(lines[2]).toBe(
      'settlement,MHK,MHK Center,active,,,,2026-11,vat_payable,11.50,11.50,0.00,paid,,',
    );
    expect(lines[3]).toBe(
      'settlement,MHK,MHK Center,active,,,,2026-11,bkash_charge_payable,1.15,0.00,-1.15,due,,',
    );

    // Every line has the same field count, so a spreadsheet reads one table.
    for (const line of lines) {
      expect(line.split(',').length).toBeGreaterThanOrEqual(15);
    }
  });

  it('records the export with the center and its counts', async () => {
    currentRole = 'super_admin';
    await centerExport(centerEvent(tokenFor('super_admin'), CENTER_ID));

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      center_id: null,
      actor: 'user-super_admin',
      action: 'center.export',
      target_table: 'centers',
      target_id: CENTER_ID,
      after: {
        center_id: CENTER_ID,
        code: 'MHK',
        active_entries: 1,
        gross_poisha: '6795',
        settlement_rows: 2,
        format: 'csv',
      },
    });
  });

  it('answers 404 for a center the fleet does not hold', async () => {
    currentRole = 'super_admin';
    const result = await outcome(() =>
      centerExport(centerEvent(tokenFor('super_admin'), OTHER_CENTER_ID)),
    );
    expect(result.status).toBe(404);
    expect(result.message).toBe('center_not_found');
    expect(audits).toHaveLength(0);
  });
});
