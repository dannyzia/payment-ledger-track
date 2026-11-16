import type { UserRole } from '@clt/shared';

/**
 * Attribution of an entry's author, in one place (Plan 023 §6.7).
 *
 * A platform-created entry's `created_by` is the super-admin seat, whose profile belongs
 * to no center. Pull delivers entries but never that profile, so a center device holds
 * an id with no name for it, and any surface that prints the author would show a bare
 * uuid. The role travels with the row precisely so this can be answered without the
 * profile.
 *
 * Every surface that names an author should call this — the entry drawer today, and a
 * ledger badge, an audit column or a CSV/XLSX export tomorrow — rather than rebuild the
 * rule and risk one of them forgetting the platform case.
 */
export const PLATFORM_AUTHOR_LABEL = 'Platform (Super Admin)';

export interface CreatorAttribution {
  /** `entries.created_by`. */
  id: string;
  /** `entries.created_by_role`; undefined for rows written before the field existed. */
  role?: UserRole | null | undefined;
  /** The cached profile's display name, when the profile is present. */
  name?: string | null | undefined;
}

export function creatorLabel({ id, role, name }: CreatorAttribution): string {
  // A cached profile wins: it is the human name, whatever the role says.
  if (name) return name;
  if (role === 'super_admin') return PLATFORM_AUTHOR_LABEL;
  return id;
}
