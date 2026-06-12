import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { GameNight } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import { queryAll } from '../db/query';
import { clubPk, nightSk, nightSkPrefix } from '../db/keys';

function toItem(night: GameNight): Record<string, unknown> {
  return {
    PK: clubPk(night.clubId),
    SK: nightSk(night.nightId),
    ...night,
  };
}

function fromItem(item: Record<string, any>): GameNight {
  return {
    nightId: item.nightId,
    clubId: item.clubId,
    title: item.title,
    eventDate: item.eventDate,
    signupDeadline: item.signupDeadline,
    status: item.status,
    eventType: item.eventType,
    pairingStrategy: item.pairingStrategy,
    offeredSystems: item.offeredSystems,
    createdBy: item.createdBy,
  };
}

export async function putNight(night: GameNight): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(night) }));
}

export async function getNight(clubId: string, nightId: string): Promise<GameNight | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: clubPk(clubId), SK: nightSk(nightId) } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

export async function listNightsByClub(clubId: string): Promise<GameNight[]> {
  const items = await queryAll({
    TableName: getTableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': clubPk(clubId), ':sk': nightSkPrefix() },
  });
  return items.map(fromItem);
}
