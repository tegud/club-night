/**
 * Provision a Club record (MVP has no self-service club registration).
 *
 * Usage (from packages/api):
 *   npx tsx scripts/seed-club.ts \
 *     --name "Northern Warlords" \
 *     --slug northern-warlords \
 *     --colour "#1f3a5f" \
 *     --logo "/club-logos/northern-warlords.png" \
 *     --systems WARHAMMER_40K,AGE_OF_SIGMAR,BLOOD_BOWL,HORUS_HERESY \
 *     [--id <existing-clubId>]
 *
 * Target table: set CLUB_NIGHT_TABLE (from the stack's `TableName` output) and AWS
 * credentials/region — or point at a local DynamoDB with DYNAMODB_ENDPOINT.
 * Re-running with the same --id (or slug, if you keep the printed id) overwrites the club.
 */
import { ulid } from 'ulid';
import { GAME_SYSTEM_KEYS, isGameSystemKey, type Club, type GameSystemKey } from '@club-night/shared';
import { putClub, getClubBySlug } from '../src/repositories/clubs';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// Clubs live at the URL root (/<slug>), so a slug must not shadow a static asset path
// served from S3 or a route we might add at the top level later.
const RESERVED_SLUGS = new Set([
  'assets', 'index', 'index.html', 'favicon.ico', 'robots.txt',
  'api', 'admin', 'login', 'logout', 'signup', 'about', 'help', 'static', 'public',
]);

async function main(): Promise<void> {
  const name = arg('--name');
  const slug = arg('--slug');
  if (!name || !slug) {
    throw new Error('Required: --name "<Club name>" --slug <url-slug>');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Invalid slug "${slug}" — use lowercase letters, digits, and single hyphens (e.g. northern-warlords)`);
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new Error(`Slug "${slug}" is reserved — it would shadow a system path. Pick another.`);
  }

  const existing = await getClubBySlug(slug);
  const clubId = arg('--id') ?? existing?.clubId ?? ulid();

  const systems = (arg('--systems')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [...GAME_SYSTEM_KEYS]);
  const bad = systems.filter((s) => !isGameSystemKey(s));
  if (bad.length) {
    throw new Error(`Unknown game system(s): ${bad.join(', ')}. Valid keys: ${GAME_SYSTEM_KEYS.join(', ')}`);
  }

  const club: Club = {
    clubId,
    slug,
    name,
    logoUrl: arg('--logo') ?? '',
    primaryColour: arg('--colour') ?? '#444444',
    enabledSystems: systems as GameSystemKey[],
  };

  await putClub(club);
  console.log(`${existing ? 'Updated' : 'Created'} club:`, JSON.stringify(club, null, 2));
  console.log(`\nclubId: ${clubId}`);
  console.log(`Public URL path: /c/${slug}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
