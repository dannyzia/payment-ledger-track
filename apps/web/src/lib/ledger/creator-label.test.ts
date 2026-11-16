import { describe, expect, it } from 'vitest';
import { creatorLabel, PLATFORM_AUTHOR_LABEL } from './creator-label';

const ID = '55555555-5555-4555-8555-555555555555';

describe('creatorLabel', () => {
  it('uses the cached profile name when the profile is present', () => {
    expect(creatorLabel({ id: ID, role: 'owner', name: 'Zia Owner' })).toBe('Zia Owner');
  });

  it('labels a platform author instead of showing the uuid', () => {
    // The seat's profile is never delivered to a center device, so the role is the only
    // thing that can identify the author.
    expect(creatorLabel({ id: ID, role: 'super_admin' })).toBe(PLATFORM_AUTHOR_LABEL);
    expect(creatorLabel({ id: ID, role: 'super_admin' })).not.toBe(ID);
  });

  it('prefers the platform label over an empty name', () => {
    // The drawer's previous `||` fallback: an empty display_name is not a name.
    expect(creatorLabel({ id: ID, role: 'super_admin', name: '' })).toBe(PLATFORM_AUTHOR_LABEL);
  });

  it('falls back to the id for a centre author whose profile is missing', () => {
    expect(creatorLabel({ id: ID, role: 'owner' })).toBe(ID);
    expect(creatorLabel({ id: ID, role: null, name: null })).toBe(ID);
  });

  it('falls back to the id when the row carries no role', () => {
    // Entries written before `created_by_role` existed have no role; they must not be
    // mislabelled as platform rows.
    expect(creatorLabel({ id: ID })).toBe(ID);
  });
});
