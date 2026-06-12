import type { Club, GameNight } from '@club-night/shared';
import { getClubBySlug } from '../repositories/clubs';
import { getNight } from '../repositories/nights';
import { NotFoundError } from '../http/errors';

export async function requireClubBySlug(slug: string): Promise<Club> {
  const club = await getClubBySlug(slug);
  if (!club) throw new NotFoundError('Club not found');
  return club;
}

export async function requireNight(clubId: string, nightId: string): Promise<GameNight> {
  const night = await getNight(clubId, nightId);
  if (!night) throw new NotFoundError('Game night not found');
  return night;
}
