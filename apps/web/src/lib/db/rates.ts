import { db, type CachedRateProfile } from './index';

/**
 * Resolves the date-effective published rate profile from local Dexie storage.
 * Ordering per PRD §6.5 & §7.3: effective_from DESC, version DESC LIMIT 1.
 */
export async function resolveEffectiveRateProfile(entryDate: string): Promise<CachedRateProfile | null> {
  const profiles = await db.rateProfiles
    .where('status')
    .equals('published')
    .toArray();

  const matching = profiles
    .filter((p) => p.effective_from <= entryDate)
    .sort((a, b) => {
      if (a.effective_from !== b.effective_from) {
        return b.effective_from.localeCompare(a.effective_from);
      }
      return b.version - a.version;
    });

  return matching[0] ?? null;
}

/**
 * Retrieves the highest published rate profile version known to the client.
 * Serves as the mandatory maxKnownRateVersion watermark (Rule 9, Finding C4).
 */
export async function getMaxKnownRateVersion(): Promise<number> {
  const profiles = await db.rateProfiles.where('status').equals('published').toArray();
  if (profiles.length === 0) return 1;
  return Math.max(...profiles.map((p) => p.version));
}
