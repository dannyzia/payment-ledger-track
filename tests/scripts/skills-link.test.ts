import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkSkills, SHARED_SKILLS } from '../../scripts/skills-link';

/**
 * `pnpm skills:link` is the only thing standing between a fresh clone and an agent tree
 * with no skills, and `.claude/` is gitignored so a mistake here is invisible in review.
 * These cases pin the four things the script promises: it creates links, it repairs a
 * stale or missing one, it never overwrites a real directory, and running it twice does
 * nothing the second time.
 *
 * It runs against a temporary tree, never the repository: a test that relinked the real
 * `.claude/skills` would be editing the workspace to check itself.
 */

let dir: string;
let sourceDir: string;
let targetDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clt-skills-link-'));
  sourceDir = path.join(dir, '.agents', 'skills');
  targetDir = path.join(dir, '.claude', 'skills');
  for (const name of SHARED_SKILLS) {
    fs.mkdirSync(path.join(sourceDir, name), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, name, 'SKILL.md'), `# ${name}\n`);
  }
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const quiet = { log: () => {}, warn: () => {}, error: () => {} };

describe('skills:link', () => {
  it('creates a relative link for every shared skill and creates the target directory', () => {
    const result = linkSkills({ sourceDir, targetDir, ...quiet });

    expect(result.code).toBe(0);
    expect(result.created).toEqual([...SHARED_SKILLS]);
    expect(result.conflicts).toEqual([]);
    for (const name of SHARED_SKILLS) {
      const target = path.join(targetDir, name);
      expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
      // Relative, so the links survive the repository being moved.
      expect(fs.readlinkSync(target)).toBe(path.relative(targetDir, path.join(sourceDir, name)));
      expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe(`# ${name}\n`);
    }
  });

  it('does nothing on a second run', () => {
    linkSkills({ sourceDir, targetDir, ...quiet });
    const result = linkSkills({ sourceDir, targetDir, ...quiet });

    expect(result.code).toBe(0);
    expect(result.created).toEqual([]);
    expect(result.relinked).toEqual([]);
    expect(result.unchanged).toEqual([...SHARED_SKILLS]);
  });

  it('repairs a link that points at the wrong skill', () => {
    linkSkills({ sourceDir, targetDir, ...quiet });
    const target = path.join(targetDir, 'brand');
    fs.unlinkSync(target);
    fs.symlinkSync(path.relative(targetDir, path.join(sourceDir, 'design')), target);

    const result = linkSkills({ sourceDir, targetDir, ...quiet });

    expect(result.relinked).toEqual(['brand']);
    expect(result.created).toEqual([]);
    expect(fs.readlinkSync(target)).toBe(path.relative(targetDir, path.join(sourceDir, 'brand')));
  });

  it('repairs a broken link rather than treating it as absent', () => {
    fs.mkdirSync(targetDir, { recursive: true });
    const target = path.join(targetDir, 'slides');
    fs.symlinkSync(path.join(dir, 'gone'), target);

    const result = linkSkills({ sourceDir, targetDir, skills: ['slides'], ...quiet });

    expect(result.relinked).toEqual(['slides']);
    expect(result.created).toEqual([]);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# slides\n');
  });

  it('leaves a real directory alone, keeps its contents, and fails', () => {
    const target = path.join(targetDir, 'design');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'mine.md'), 'do not delete\n');

    const result = linkSkills({ sourceDir, targetDir, skills: ['design', 'brand'], ...quiet });

    expect(result.code).toBe(1);
    expect(result.conflicts).toEqual(['design']);
    expect(result.created).toEqual(['brand']);
    expect(fs.lstatSync(target).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(target, 'mine.md'), 'utf8')).toBe('do not delete\n');
  });

  it('skips a skill with no source without failing', () => {
    const result = linkSkills({
      sourceDir,
      targetDir,
      skills: ['brand', 'not-installed'],
      ...quiet,
    });

    expect(result.code).toBe(0);
    expect(result.created).toEqual(['brand']);
    expect(result.missing).toEqual(['not-installed']);
    expect(fs.existsSync(path.join(targetDir, 'not-installed'))).toBe(false);
  });

  it('fails when the source tree is absent', () => {
    const result = linkSkills({ sourceDir: path.join(dir, 'nope'), targetDir, ...quiet });

    expect(result.code).toBe(1);
    expect(result.created).toEqual([]);
    expect(fs.existsSync(targetDir)).toBe(false);
  });
});
