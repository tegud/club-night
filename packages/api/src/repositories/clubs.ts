import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Club } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import { clubMetaSk, clubPk, clubSlugGsi1Pk } from '../db/keys';
import { TABLE_INDEXES } from '../db/table';

function toItem(club: Club): Record<string, unknown> {
  return {
    PK: clubPk(club.clubId),
    SK: clubMetaSk(),
    GSI1PK: clubSlugGsi1Pk(club.slug),
    GSI1SK: clubPk(club.clubId),
    ...club,
  };
}

function fromItem(item: Record<string, any>): Club {
  return {
    clubId: item.clubId,
    slug: item.slug,
    name: item.name,
    logoUrl: item.logoUrl,
    primaryColour: item.primaryColour,
    enabledSystems: item.enabledSystems,
  };
}

export async function putClub(club: Club): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(club) }));
}

export async function getClubById(clubId: string): Promise<Club | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: clubPk(clubId), SK: clubMetaSk() } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

export async function getClubBySlug(slug: string): Promise<Club | null> {
  const res = await getDocClient().send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: TABLE_INDEXES.bySlug,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': clubSlugGsi1Pk(slug) },
      Limit: 1,
    }),
  );
  const item = res.Items?.[0];
  return item ? fromItem(item) : null;
}
