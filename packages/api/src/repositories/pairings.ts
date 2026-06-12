import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Pairing } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import { pairingPk, pairingSk, pairingSkPrefix } from '../db/keys';
import { queryAll } from '../db/query';

function toItem(p: Pairing): Record<string, unknown> {
  return {
    PK: pairingPk(p.nightId),
    SK: pairingSk(p.systemKey, p.pairingId),
    ...p,
  };
}

function fromItem(item: Record<string, any>): Pairing {
  return {
    pairingId: item.pairingId,
    nightId: item.nightId,
    clubId: item.clubId,
    systemKey: item.systemKey,
    players: item.players,
    status: item.status,
  };
}

export async function putPairing(pairing: Pairing): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(pairing) }));
}

export async function listPairingsByNight(nightId: string): Promise<Pairing[]> {
  const items = await queryAll({
    TableName: getTableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pairingPk(nightId), ':sk': pairingSkPrefix() },
  });
  return items.map(fromItem);
}

export async function deletePairing(pairing: Pairing): Promise<void> {
  await getDocClient().send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: pairingPk(pairing.nightId), SK: pairingSk(pairing.systemKey, pairing.pairingId) },
    }),
  );
}

export async function deletePairingsByNight(nightId: string): Promise<void> {
  const items = await queryAll({
    TableName: getTableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pairingPk(nightId), ':sk': pairingSkPrefix() },
  });
  for (const item of items) {
    await getDocClient().send(
      new DeleteCommand({ TableName: getTableName(), Key: { PK: item.PK, SK: item.SK } }),
    );
  }
}
