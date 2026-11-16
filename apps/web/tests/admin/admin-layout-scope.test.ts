import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserRole } from '@clt/shared';
import { isCenterScoped } from '$lib/capabilities';

/**
 * Closing the gate gaps means more than the two the parity table pinned: the seat also
 * had to stop reaching the center-admin group. Every route behind `/admin` except
 * `/admin/super/*` refuses a super-admin caller (they check `caller.role` for admin or
 * owner), so the group layout refuses the seat once instead of letting each screen
 * render over a 403.
 */

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LAYOUT = path.join(APP_ROOT, 'src/routes/(app)/admin/+layout.svelte');

const ROLES: UserRole[] = ['staff', 'admin', 'owner', 'super_admin'];

describe('center-admin group refuses the platform seat (plan 023)', () => {
  it('treats every center role as scoped and the seat as not', () => {
    expect(ROLES.filter(isCenterScoped)).toEqual(['staff', 'admin', 'owner']);
    expect(isCenterScoped('super_admin')).toBe(false);
  });

  it('gates the group on that scope, exempting the platform branch', () => {
    const source = fs.readFileSync(LAYOUT, 'utf8');

    expect(source).toContain("import { isCenterScoped } from '$lib/capabilities'");
    expect(source).toContain("page.url.pathname.startsWith('/admin/super')");
    expect(source).toContain('platformPath || isCenterScoped(role)');
    expect(source).toContain('Access Denied');
    // The children must be behind the gate, not rendered alongside it.
    expect(source).toContain('{#if allowed}');
    expect(source).toContain('{@render children()}');
  });
});
