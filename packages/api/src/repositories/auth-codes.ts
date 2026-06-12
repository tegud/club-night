import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../db/client';
import { authCodePk, authCodeSk } from '../db/keys';

export interface AuthCodeRecord {
  clubId: string;
  /** lowercased email */
  email: string;
  codeHash: string;
  /** epoch seconds; also the DynamoDB TTL attribute for real-DynamoDB cleanup */
  ttl: number;
}

function toItem(rec: AuthCodeRecord): Record<string, unknown> {
  const email = rec.email.toLowerCase();
  return {
    PK: authCodePk(rec.clubId, email),
    SK: authCodeSk(),
    ...rec,
    email,
  };
}

function fromItem(item: Record<string, any>): AuthCodeRecord {
  return {
    clubId: item.clubId,
    email: item.email,
    codeHash: item.codeHash,
    ttl: item.ttl,
  };
}

export async function putAuthCode(rec: AuthCodeRecord): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(rec) }));
}

export async function getAuthCode(clubId: string, email: string): Promise<AuthCodeRecord | null> {
  const emailLower = email.toLowerCase();
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: authCodePk(clubId, emailLower), SK: authCodeSk() } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

export async function deleteAuthCode(clubId: string, email: string): Promise<void> {
  const emailLower = email.toLowerCase();
  await getDocClient().send(
    new DeleteCommand({ TableName: getTableName(), Key: { PK: authCodePk(clubId, emailLower), SK: authCodeSk() } }),
  );
}
