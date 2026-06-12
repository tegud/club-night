import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { queryAll } from '../db/query';
import { ulid } from 'ulid';
import type { GameSystemKey, Signup } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import {
  signupEmailGsi3Pk,
  signupPk,
  signupSk,
  signupSkPrefix,
  userGsi2Pk,
} from '../db/keys';
import { TABLE_INDEXES } from '../db/table';

export interface CreateSignupInput {
  nightId: string;
  clubId: string;
  playerName: string;
  email: string;
  systemKey: GameSystemKey;
  note?: string;
  userId?: string;
}

function toItem(signup: Signup): Record<string, unknown> {
  const item: Record<string, unknown> = {
    PK: signupPk(signup.nightId),
    SK: signupSk(signup.signupId),
    GSI3PK: signupEmailGsi3Pk(signup.nightId, signup.email),
    GSI3SK: signupSk(signup.signupId),
    ...signup,
  };
  if (signup.userId) {
    item.GSI2PK = userGsi2Pk(signup.userId);
    item.GSI2SK = signupSk(signup.signupId);
  }
  return item;
}

function fromItem(item: Record<string, any>): Signup {
  return {
    signupId: item.signupId,
    nightId: item.nightId,
    clubId: item.clubId,
    playerName: item.playerName,
    email: item.email,
    systemKey: item.systemKey,
    status: item.status,
    ...(item.userId !== undefined ? { userId: item.userId } : {}),
    ...(item.note !== undefined ? { note: item.note } : {}),
    ...(item.requestedOpponentSignupId !== undefined
      ? { requestedOpponentSignupId: item.requestedOpponentSignupId }
      : {}),
  };
}

export async function findSignupByEmail(nightId: string, emailLower: string): Promise<Signup | null> {
  const res = await getDocClient().send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: TABLE_INDEXES.byNightEmail,
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': signupEmailGsi3Pk(nightId, emailLower) },
      Limit: 1,
    }),
  );
  const item = res.Items?.[0];
  return item ? fromItem(item) : null;
}

/**
 * Create a signup, or update the existing one if this email already signed up
 * for this night (one signup per email per night). Email is lowercased.
 */
export async function upsertSignup(input: CreateSignupInput): Promise<Signup> {
  const email = input.email.toLowerCase();
  // MVP: last-write-wins if the same email submits concurrently; acceptable at this scale.
  const existing = await findSignupByEmail(input.nightId, email);
  const signupId = existing?.signupId ?? ulid();
  const signup: Signup = {
    signupId,
    nightId: input.nightId,
    clubId: input.clubId,
    playerName: input.playerName,
    email,
    systemKey: input.systemKey,
    status: 'CONFIRMED',
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
  };
  await putSignup(signup);
  return signup;
}

export async function putSignup(signup: Signup): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(signup) }));
}

export async function getSignup(nightId: string, signupId: string): Promise<Signup | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: signupPk(nightId), SK: signupSk(signupId) } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

/** Lists ALL signups for a night, including CANCELLED ones. Callers that need only
 *  active signups (e.g. pairing) must filter by status === 'CONFIRMED'. */
export async function listSignupsByNight(nightId: string): Promise<Signup[]> {
  const items = await queryAll({
    TableName: getTableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': signupPk(nightId), ':sk': signupSkPrefix() },
  });
  return items.map(fromItem);
}
