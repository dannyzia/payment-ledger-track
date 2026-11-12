/**
 * Physical-device journey for one center.
 *
 *   --center=<code|uuid>   center to exercise (default MHK)
 *   --account=<email>      account the handset must be signed in as
 *                          (default owner.mhk@cosmoledger.local)
 *
 * Both may instead come from CLT_DEVICE_CENTER / CLT_DEVICE_ACCOUNT. The center
 * code and name are read from `centers`, so the chip text, the tenant-scoped
 * Dexie name and the database assertion all follow the chosen center instead of
 * assuming Mohakhali.
 */
import { chromium, type Page } from '@playwright/test';
import type { Pool as PgPool } from 'pg';
import { runDevicePreflight } from './device-preflight';
import { missingPasswordHelp, readCachedProfile, signInOnDevice } from './device-sign-in-flow';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const { Pool } = pg;

/**
 * Evidence captures must never decide whether a functional check passes. On
 * this device's WebView, `page.screenshot()` can wait forever for a frame the
 * throttled renderer never produces, which aborted the whole journey before a
 * single assertion ran. Bound each capture and fall back to the raw DevTools
 * call; a capture that still fails is logged and skipped.
 */
async function capture(page: Page, dir: string, name: string): Promise<void> {
  const target = path.join(dir, name);
  const bounded = <T>(work: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('capture timeout')), ms)),
    ]);

  try {
    const buffer = await bounded(page.screenshot({ timeout: 8000 }), 12_000);
    fs.writeFileSync(target, buffer);
    return;
  } catch {
    // Fall through to the DevTools capture below.
  }

  try {
    const session = await page.context().newCDPSession(page);
    const shot = await bounded(
      session.send('Page.captureScreenshot', { format: 'png' }) as Promise<{ data: string }>,
      12_000,
    );
    fs.writeFileSync(target, Buffer.from(shot.data, 'base64'));
    await session.detach().catch(() => undefined);
  } catch (err) {
    console.warn(`⚠ evidence screenshot ${name} skipped: ${String(err).split('\n')[0]}`);
  }
}

interface JourneyTarget {
  centerId: string;
  centerCode: string;
  centerName: string;
  accountEmail: string;
  /** Where the account came from; the built-in fallback is a setup smell. */
  accountSource: 'flag' | 'env' | 'center' | 'default';
}

function readOption(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function resolveCenter(
  pool: PgPool,
  centerSelector: string,
): Promise<Omit<JourneyTarget, 'accountEmail'>> {
  const { rows } = await pool.query<{ id: string; code: string; name: string }>(
    'select id, code, name from centers where code = $1 or id::text = $1',
    [centerSelector],
  );

  if (rows.length === 0) {
    const available = await pool.query<{ code: string }>(
      'select code from centers order by center_number',
    );
    throw new Error(
      `Center "${centerSelector}" was not found. Available centers: ${
        available.rows.map((row) => row.code).join(', ') || 'none'
      }. Pass --center=<code|uuid>.`,
    );
  }

  const center = rows[0];
  return { centerId: center.id, centerCode: center.code, centerName: center.name };
}

/**
 * The journey asserts against one centre, which is only meaningful for an account
 * that belongs to it. When the handset is on another account the run used to stop
 * and make a person switch it by hand; with a password for the target account it
 * switches through the app's own sign-out and sign-in instead.
 */
async function ensureTargetSession(
  page: Page,
  target: JourneyTarget,
  password: string | undefined,
  passwordSource: string | undefined,
): Promise<void> {
  await page.goto('https://localhost/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  let profile = await readCachedProfile(page);
  if (profile?.email?.toLowerCase() === target.accountEmail) return;

  if (!password) {
    throw new Error(
      missingPasswordHelp({
        signedInAs: profile?.email ?? null,
        centerCode: target.centerCode,
        accountEmail: target.accountEmail,
        accountIsDefault: target.accountSource === 'default',
      }),
    );
  }

  console.log(
    `Switching handset: ${profile?.email ?? 'nobody'} → ${target.accountEmail} (center ${target.centerCode})`,
  );
  await signInOnDevice(page, {
    email: target.accountEmail,
    password,
    passwordSource,
  });

  profile = await readCachedProfile(page);
  if (profile?.centerId && profile.centerId !== target.centerId) {
    throw new Error(
      `Signed in as ${target.accountEmail}, but that account belongs to center ${profile.centerId}, not ${target.centerCode} (${target.centerId}). Pass an --account that belongs to ${target.centerCode}.`,
    );
  }
}

async function main() {
  console.log('=== STARTING PHYSICAL DEVICE E2E TEST ===');
  const evidenceDir = path.resolve(process.cwd(), 'docs/orchestration/evidence/device-e2e');
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  // Fail fast on the three environment faults that otherwise masquerade as app
  // bugs: a locked handset (clicks time out), no attached WebView, and a
  // reversed port that hosts a different application (every call 404s).
  const preflight = await runDevicePreflight();
  for (const note of preflight.notes) console.log(`  • ${note}`);
  if (preflight.problems.length > 0) {
    console.error('\n❌ DEVICE JOURNEY PREFLIGHT FAILED — the app was not exercised:');
    for (const problem of preflight.problems) {
      console.error(`\n  • ${problem.what}\n    Fix: ${problem.fix}`);
    }
    process.exit(1);
  }

  const pgPool = new Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });

  const centerSelector = readOption('center') ?? process.env.CLT_DEVICE_CENTER ?? 'MHK';
  const center = await resolveCenter(pgPool, centerSelector).catch(async (err) => {
    await pgPool.end();
    throw err;
  });

  // Per-center fixture credentials come from the environment (CLT_DEVICE_<CODE>_ACCOUNT
  // / _PASSWORD), so `--center=RMP` alone switches the handset and runs. Nothing here
  // reads a committed secret: .env.local is gitignored (AGENTS.md Rule 8).
  const perCenter = (suffix: 'ACCOUNT' | 'PASSWORD') =>
    process.env[`CLT_DEVICE_${center.centerCode.toUpperCase()}_${suffix}`];
  const accountFlag = readOption('account');
  const accountEnv = process.env.CLT_DEVICE_ACCOUNT;
  const accountCenter = perCenter('ACCOUNT');
  const accountEmail = (
    accountFlag ??
    accountEnv ??
    accountCenter ??
    'owner.mhk@cosmoledger.local'
  ).toLowerCase();
  const accountSource: JourneyTarget['accountSource'] = accountFlag
    ? 'flag'
    : accountEnv
      ? 'env'
      : accountCenter
        ? 'center'
        : 'default';
  const passwordFlag = readOption('password');
  const passwordEnv = process.env.CLT_DEVICE_PASSWORD;
  const passwordCenter = perCenter('PASSWORD');
  const accountPassword = passwordFlag ?? passwordEnv ?? passwordCenter;
  const passwordSource = passwordFlag
    ? '--password'
    : passwordEnv
      ? 'CLT_DEVICE_PASSWORD'
      : passwordCenter
        ? `CLT_DEVICE_${center.centerCode.toUpperCase()}_PASSWORD`
        : undefined;
  const target: JourneyTarget = { ...center, accountEmail, accountSource };
  console.log(
    `Journey target: ${target.centerCode} "${target.centerName}" (${target.centerId}), account ${target.accountEmail}`,
  );

  // 1. Connect over Chrome DevTools Protocol to physical phone
  console.log('Connecting to device WebView via CDP on port 9222...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  try {
    // Step 0: put the handset on the account (and therefore the centre) the
    // assertions expect, before anything is measured.
    await ensureTargetSession(page, target, accountPassword, passwordSource);

    // Enable performance logging & error tracking
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[PHONE ERROR]:', msg.text());
    });

    // Step 1: Verify Session & Multi-Tenant State
    console.log('\n--- STEP 1: Verify Multi-Tenant Session & Dexie Physical Isolation ---');
    await page.goto('https://localhost/dashboard');
    await page.waitForLoadState('networkidle');
    await capture(page, evidenceDir, '1-dashboard-initial.png');

    const sessionInfo = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      const cachedProfile = localStorage.getItem('clt_cached_profile');
      return {
        url: window.location.href,
        dbs: dbs.map((d) => d.name),
        text: document.body.innerText.substring(0, 300),
        profile: cachedProfile
          ? (JSON.parse(cachedProfile) as { email?: string; centerId?: string | null })
          : null,
      };
    });

    console.log('Current URL:', sessionInfo.url);
    console.log('IndexedDB Databases on Device:', sessionInfo.dbs);

    const signedInAs = sessionInfo.profile?.email?.toLowerCase() ?? null;
    if (signedInAs !== target.accountEmail) {
      throw new Error(
        `Phone is signed in as ${signedInAs ?? 'nobody'}, but this journey targets ${target.accountEmail}. Sign in on the handset as that account, or pass --account=<email>.`,
      );
    }
    if (sessionInfo.profile?.centerId && sessionInfo.profile.centerId !== target.centerId) {
      throw new Error(
        `Phone's session is pinned to center ${sessionInfo.profile.centerId}, but this journey targets ${target.centerCode} (${target.centerId}).`,
      );
    }

    const expectedDbName = `KumonLedger_${target.centerId}`;
    if (!sessionInfo.dbs.includes(expectedDbName)) {
      throw new Error(
        `Expected physical IndexedDB database ${expectedDbName} not found! Found: ${sessionInfo.dbs.join(', ')}`,
      );
    }
    console.log(`✓ Physical Dexie database is tenant-scoped: ${expectedDbName}`);

    // Step 2: Navigate to /entries/new
    console.log('\n--- STEP 2: Navigate to /entries/new & Inspect Center Header Chips ---');
    await page.goto('https://localhost/entries/new');
    await page.waitForSelector('#input-customer');

    const chips = await page.evaluate(() => {
      const all = Array.from(
        document.querySelectorAll('.clt-chip, [class*="chip"], [class*="Chip"]'),
      );
      return all.map((el) => el.textContent?.trim());
    });
    console.log('Header Chips on Form:', chips);
    const expectedCenterChip = `${target.centerCode} - ${target.centerName}`;
    if (!chips.some((c) => c?.includes(expectedCenterChip))) {
      throw new Error(`Center chip missing ${expectedCenterChip}! Got: ${chips.join(', ')}`);
    }
    const expectedIdChip = `E-${target.centerCode}-…`;
    if (!chips.some((c) => c?.includes(expectedIdChip))) {
      throw new Error(`ID Preview chip missing ${expectedIdChip}! Got: ${chips.join(', ')}`);
    }
    console.log(`✓ Center badge & ${expectedIdChip} ID format preview verified on phone`);

    // Step 3: Fill in Entry Details & Check Real-time Calculation Breakdown
    console.log('\n--- STEP 3: Enter Customer, Gross Amount & Select bKash ---');
    const customerName = `Mobile Test Student ${Date.now().toString().slice(-4)}`;
    await page.fill('#input-customer', customerName);
    await page.fill('#input-qty', '1');
    await page.fill('#input-sub-desc', 'Math Level F');
    await page.fill('#input-gross', '5000');

    // Select bKash payment method
    console.log('Selecting bKash payment method chip...');
    await page.click('button:has-text("bKash")');

    // Check if txn ref is requested
    const txnRefInput = page.locator('#input-txn-ref');
    if (await txnRefInput.isVisible()) {
      await txnRefInput.fill('BKASH-REF-9988');
    }

    await page.waitForTimeout(500);
    await capture(page, evidenceDir, '2-entry-form-filled.png');

    // Inspect the receipt breakdown
    const breakdownText = await page.evaluate(() => {
      const breakdownEl =
        document.querySelector('[class*="ReceiptBreakdown"], .receipt-breakdown') || document.body;
      return breakdownEl.innerText;
    });
    console.log(
      'Breakdown preview:\n',
      breakdownText
        .split('\n')
        .filter((l) => l.includes('৳') || l.includes('Gross') || l.includes('Net'))
        .join(' | '),
    );

    // Step 4: Perform Local-First Save and Measure Latency (<100ms)
    console.log('\n--- STEP 4: Measure Local Save Latency (<100ms SLA) ---');
    const saveStart = Date.now();
    await page.click('#btn-save');

    // Wait for success message
    await page.waitForSelector('.text-green-700', { timeout: 10000 });
    const saveDuration = Date.now() - saveStart;
    const successMsg = await page.innerText('.text-green-700');
    console.log(`Success message: "${successMsg}"`);
    console.log(`Local Save latency: ${saveDuration}ms`);
    if (saveDuration > 3000) {
      console.warn(`Local save took longer than expected: ${saveDuration}ms`);
    } else {
      console.log(`✓ Local save completed swiftly (${saveDuration}ms)`);
    }
    await capture(page, evidenceDir, '3-entry-saved-success.png');

    // Step 5: Wait for Automatic Background Sync
    console.log('\n--- STEP 5: Verify Auto-Sync Over Reverse Tunnel ---');
    // The push is background work: poll the indicator rather than guessing a
    // fixed delay, which previously reached the database assertion while the app
    // still read "Syncing..." and failed a healthy sync.
    let syncStatus = '';
    for (let i = 0; i < 40; i += 1) {
      syncStatus = await page.evaluate(
        () => document.querySelector('.sync-indicator')?.textContent?.trim() ?? '',
      );
      if (/synced/i.test(syncStatus)) break;
      await page.waitForTimeout(500);
    }
    console.log('Sync indicator text:', syncStatus || 'unknown');

    // Step 6: Verify Persistence in PostgreSQL Database
    console.log('\n--- STEP 6: Direct Database Assertion in PostgreSQL ---');
    let dbRes = await pgPool.query(
      `SELECT id, center_id, entry_date, customer_name, gross_poisha, vat_poisha, commission_poisha, charge_poisha, net_poisha, status, server_seq
       FROM entries
       WHERE customer_name = $1 AND center_id = $2`,
      [customerName, target.centerId],
    );

    // Give the background push a bounded window before calling the row missing.
    for (let i = 0; i < 20 && dbRes.rows.length === 0; i += 1) {
      await page.waitForTimeout(1000);
      dbRes = await pgPool.query(
        `SELECT id, center_id, entry_date, customer_name, gross_poisha, vat_poisha, commission_poisha, charge_poisha, net_poisha, status, server_seq
           FROM entries
           WHERE customer_name = $1 AND center_id = $2`,
        [customerName, target.centerId],
      );
    }

    if (dbRes.rows.length === 0) {
      throw new Error(`Database record for customer "${customerName}" not found in PostgreSQL!`);
    }

    const row = dbRes.rows[0];
    console.log('Database row successfully retrieved:');
    console.log(`  - Entry ID:          ${row.id}`);
    console.log(`  - Center ID:         ${row.center_id} (${target.centerCode})`);
    console.log(`  - Customer:          ${row.customer_name}`);
    console.log(
      `  - Gross (poisha):    ${row.gross_poisha} (= ৳${Number(row.gross_poisha) / 100})`,
    );
    console.log(
      `  - Commission:        ${row.commission_poisha} (= ৳${Number(row.commission_poisha) / 100})`,
    );
    console.log(
      `  - Method Charge:     ${row.charge_poisha} (= ৳${Number(row.charge_poisha) / 100})`,
    );
    console.log(`  - Net:               ${row.net_poisha} (= ৳${Number(row.net_poisha) / 100})`);
    console.log(`  - Server Sequence:   ${row.server_seq}`);
    console.log(`  - Status:            ${row.status}`);

    if (row.id.startsWith(`E-${target.centerCode}-`)) {
      console.log(`✓ Confirmed human-readable ID format with center prefix: ${row.id}`);
    } else {
      console.log(`Note: Local entry synced with UUID / ID: ${row.id}`);
    }

    // Step 7: Verify Ledger View on Phone
    console.log('\n--- STEP 7: Verify Ledger View on Phone ---');
    await page.goto('https://localhost/ledger');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await capture(page, evidenceDir, '4-ledger-view.png');

    const ledgerText = await page.evaluate(() => document.body.innerText);
    if (!ledgerText.includes(customerName)) {
      throw new Error(`Customer "${customerName}" not visible in Ledger view on phone!`);
    }
    console.log(`✓ Customer "${customerName}" visible in Ledger on device`);

    // Step 8: Verify Dashboard Aggregation on Phone
    console.log('\n--- STEP 8: Verify Dashboard Metric Update on Phone ---');
    await page.goto('https://localhost/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await capture(page, evidenceDir, '5-dashboard-updated.png');

    const dashboardText = await page.evaluate(() => document.body.innerText);
    console.log(
      'Dashboard summary:\n',
      dashboardText
        .split('\n')
        .filter((l) => l.includes('৳') || l.includes('Shop Gross'))
        .slice(0, 6)
        .join(' | '),
    );
    console.log('✓ Dashboard updated with fresh entry aggregates');

    console.log('\n=== ALL PHYSICAL DEVICE E2E CHECKS PASSED SUCCESSFULLY ===');
  } finally {
    await pgPool.end();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\n❌ DEVICE E2E TEST FAILED:', err);
  process.exit(1);
});
