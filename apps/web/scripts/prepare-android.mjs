#!/usr/bin/env node
/**
 * Keep the Android shell's identity and debug-network setup intact across a
 * regenerated `android/` folder.
 *
 * `npx cap add android` scaffolds the platform from Capacitor's template, which
 * hard-codes the app name into `AndroidManifest.xml` and ships no debug-only
 * network override. `cap sync android` does not repair either, so a regenerated
 * folder silently loses:
 *   - the `@string/app_name` indirection (the label drifts from
 *     `capacitor.config.ts` and every rename needs a manifest edit), and
 *   - cleartext HTTP for debug builds, which the LAN dev backend needs.
 *
 * This script is idempotent and safe to re-run: it only writes a file when its
 * content actually changes. Run it after `cap add android` and after every
 * `cap sync android`; the `android:add` / `android:sync` package scripts do
 * both for you.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = path.join(appRoot, 'android');
const mainManifestPath = path.join(androidRoot, 'app/src/main/AndroidManifest.xml');
const debugManifestPath = path.join(androidRoot, 'app/src/debug/AndroidManifest.xml');
const stringsPath = path.join(androidRoot, 'app/src/main/res/values/strings.xml');
const configPath = path.join(appRoot, 'capacitor.config.ts');

if (!fs.existsSync(mainManifestPath)) {
  console.error(
    `prepare-android: ${path.relative(appRoot, mainManifestPath)} is missing.\n` +
      'Run `pnpm android:add` (or `npx cap add android`) to scaffold the platform first.',
  );
  process.exit(1);
}
if (!fs.existsSync(configPath)) {
  console.error(`prepare-android: ${configPath} is missing; cannot read the app name.`);
  process.exit(1);
}

/** Reads a top-level string property such as `appName: 'X'` from the TS config. */
function readConfigString(key) {
  const source = fs.readFileSync(configPath, 'utf8');
  const match = new RegExp(`\\b${key}\\s*:\\s*['"]([^'"]+)['"]`).exec(source);
  if (!match) {
    console.error(`prepare-android: could not read \`${key}\` from capacitor.config.ts.`);
    process.exit(1);
  }
  return match[1];
}

const appName = readConfigString('appName');
const appId = readConfigString('appId');

const changes = [];
function writeIfChanged(file, next, description) {
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (previous === next) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  changes.push(description);
  return true;
}

const escapeXml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function setStringResource(xml, name, value) {
  const existing = new RegExp(`(<string name="${name}")>[^<]*(</string>)`);
  if (existing.test(xml)) return xml.replace(existing, `$1>${escapeXml(value)}$2`);
  return xml.replace(
    /<\/resources>/,
    `    <string name="${name}">${escapeXml(value)}</string>\n</resources>`,
  );
}

// 1. strings.xml carries the human-readable name the manifest points at.
const stringsTemplate = "<?xml version='1.0' encoding='utf-8'?>\n<resources>\n</resources>\n";
let strings = fs.existsSync(stringsPath) ? fs.readFileSync(stringsPath, 'utf8') : stringsTemplate;
strings = setStringResource(strings, 'app_name', appName);
strings = setStringResource(strings, 'title_activity_main', appName);
strings = setStringResource(strings, 'package_name', appId);
strings = setStringResource(strings, 'custom_url_scheme', appId);
writeIfChanged(stringsPath, strings, 'strings.xml (app_name/title_activity_main/package_name)');

// 2. Main manifest: label via the string resource, and no cleartext. Release
//    builds stay HTTPS-only; plain HTTP is a debug-only affordance below.
const mainManifest = fs.readFileSync(mainManifestPath, 'utf8');
if (!/android:label="/.test(mainManifest)) {
  console.error('prepare-android: no android:label found in the main manifest.');
  process.exit(1);
}
let patchedMain = mainManifest.replace(
  /android:label="[^"]*"/g,
  'android:label="@string/app_name"',
);
const cleartextAttr = /\s*android:usesCleartextTraffic="[^"]*"/g;
const hadMainCleartext = cleartextAttr.test(patchedMain);
patchedMain = patchedMain.replace(cleartextAttr, '');
writeIfChanged(
  mainManifestPath,
  patchedMain,
  hadMainCleartext
    ? 'main AndroidManifest.xml (label @string/app_name, removed release cleartext)'
    : 'main AndroidManifest.xml (label @string/app_name)',
);

// 3. Debug manifest: the only place cleartext is allowed.
const debugManifestTemplate = `<?xml version="1.0" encoding="utf-8"?>
<!-- Debug builds only: the local backend is plain HTTP on the LAN. Release
     builds keep cleartext disabled (see capacitor.config.ts server.cleartext). -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:usesCleartextTraffic="true" />
</manifest>
`;
if (!fs.existsSync(debugManifestPath)) {
  writeIfChanged(debugManifestPath, debugManifestTemplate, 'debug AndroidManifest.xml (created)');
} else {
  const debugManifest = fs.readFileSync(debugManifestPath, 'utf8');
  let patchedDebug = debugManifest;
  if (!/android:usesCleartextTraffic="true"/.test(patchedDebug)) {
    patchedDebug = /<application\b[^>]*\/>/.test(patchedDebug)
      ? patchedDebug.replace(
          /<application\b([^>]*?)\s*\/>/,
          '<application$1 android:usesCleartextTraffic="true" />',
        )
      : patchedDebug.replace(
          /<application\b([^>]*?)>/,
          '<application$1 android:usesCleartextTraffic="true">',
        );
    if (!/android:usesCleartextTraffic="true"/.test(patchedDebug)) {
      console.error('prepare-android: could not add usesCleartextTraffic to the debug manifest.');
      process.exit(1);
    }
  }
  if (!/xmlns:android=/.test(patchedDebug)) {
    patchedDebug = patchedDebug.replace(
      /<manifest\b/,
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
    );
  }
  writeIfChanged(
    debugManifestPath,
    patchedDebug,
    'debug AndroidManifest.xml (usesCleartextTraffic)',
  );
}

if (changes.length === 0) {
  console.log(`prepare-android: already correct (app "${appName}" / ${appId}).`);
} else {
  console.log(`prepare-android: patched for app "${appName}" / ${appId}`);
  for (const change of changes) console.log(`  - ${change}`);
}
