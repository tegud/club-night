import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Membership } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import { clubPk, membershipSk, userGsi2Pk } from '../db/keys';

function toItem(m: Membership): Record<string, unknown> {
  return {
    PK: clubPk(m.clubId),
    SK: membershipSk(m.userId),
    GSI2PK: userGsi2Pk(m.userId),
    GSI2SK: clubPk(m.clubId),
    ...m,
  };
}

function fromItem(item: Record<string, any>): Membership {
  return {
    clubId: item.clubId,
    userId: item.userId,
    role: item.role,
    displayName: item.displayName,
    email: item.email,
  };
}

export async function putMembership(m: Membership): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(m) }));
}

export async function getMembership(clubId: string, userId: string): Promise<Membership | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: clubPk(clubId), SK: membershipSk(userId) } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}
