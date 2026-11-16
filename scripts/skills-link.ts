import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Recreates `.claude/skills` as symlinks into `.agents/skills`.
 *
 * Both agent trees read the same seven design skills, and `.claude/` is gitignored, so a
 * fresh clone has no `.claude/skills` at all. Without the links an agent running on Claude
 * Code sees no skills, and a copy instead of a link drifts silently: `ui-ux-pro-max` once
 * held two different versions of the same SKILL.md.
 *
 * The seven are named here on purpose — the rest of `.agents/skills` (`rhizome-*`,
 * `egm-*`, `impeccable`, `web-design-guidelines`) has no Claude counterpart and is not
 * exposed to Claude Code.
 *
 * Usage: pnpm skills:link
 * Idempotent. A real directory sitting where a link belongs is left alone and reported,
 * because replacing it would discard whatever a person put there.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, '.agents', 'skills');
const TARGET_DIR = path.join(ROOT, '.claude', 'skills');

export const SHARED_SKILLS = [
  'banner-design',
  'brand',
  'design',
  'design-system',
  'slides',
  'ui-styling',
  'ui-ux-pro-max',
] as const;

export interface LinkSkillsOptions {
  /** Where the real skill directories live. */
  sourceDir: string;
  /** Where the links belong; created when absent. */
  targetDir: string;
  /** Skills to expose; defaults to the shared seven. */
  skills?: readonly string[];
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface LinkSkillsResult {
  /** 0 when every link is in place, 1 when something needs a person. */
  code: 0 | 1;
  created: string[];
  relinked: string[];
  unchanged: string[];
  /** Named in `skills` but absent from `sourceDir`; skipped, not a failure. */
  missing: string[];
  /** A non-link entry occupies the target path; untouched. */
  conflicts: string[];
}

/**
 * Link each requested skill, and report what happened per name. Split from `main` so the
 * test can point it at a temporary directory: the real script runs at import time
 * otherwise, which would exit the test runner.
 */
export function linkSkills(options: LinkSkillsOptions): LinkSkillsResult {
  const { sourceDir, targetDir } = options;
  const skills = options.skills ?? SHARED_SKILLS;
  const log = options.log ?? ((message: string) => console.info(message));
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const error = options.error ?? ((message: string) => console.error(message));

  const result: LinkSkillsResult = {
    code: 0,
    created: [],
    relinked: [],
    unchanged: [],
    missing: [],
    conflicts: [],
  };

  if (!fs.existsSync(sourceDir)) {
    error(`skills:link: ${sourceDir} is missing; nothing to link.`);
    result.code = 1;
    return result;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const name of skills) {
    const source = path.join(sourceDir, name);
    const target = path.join(targetDir, name);
    const link = path.relative(targetDir, source);

    if (!fs.existsSync(source)) {
      result.missing.push(name);
      continue;
    }

    // `lstat`, not `exists`, so a broken link is seen and repaired instead of replaced.
    const entry = fs.lstatSync(target, { throwIfNoEntry: false });
    if (entry) {
      if (!entry.isSymbolicLink()) {
        result.conflicts.push(name);
        continue;
      }
      if (fs.readlinkSync(target) === link) {
        result.unchanged.push(name);
        continue;
      }
      fs.unlinkSync(target);
      fs.symlinkSync(link, target);
      result.relinked.push(name);
      continue;
    }

    fs.symlinkSync(link, target);
    result.created.push(name);
  }

  log(`skills:link: ${targetDir} -> ${sourceDir}`);
  if (result.created.length > 0) log(`  created: ${result.created.join(', ')}`);
  if (result.relinked.length > 0) log(`  relinked: ${result.relinked.join(', ')}`);
  if (result.unchanged.length > 0) log(`  unchanged: ${result.unchanged.join(', ')}`);
  if (result.missing.length > 0) warn(`  skipped, no such skill: ${result.missing.join(', ')}`);
  if (result.conflicts.length > 0) {
    error(
      `  left alone, a real entry is in the way (remove it and re-run): ${result.conflicts.join(', ')}`,
    );
    result.code = 1;
  }

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(linkSkills({ sourceDir: SOURCE_DIR, targetDir: TARGET_DIR }).code);
}
