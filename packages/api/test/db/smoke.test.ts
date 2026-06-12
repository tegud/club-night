import { describe, it, expect, beforeEach } from 'vitest';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { resetTable } from '../setup/table';
import { getDocClient, getTableName } from '../../src/db/client';

beforeEach(async () => {
  await resetTable();
});

describe('dynamodb harness', () => {
  it('round-trips an item through dynalite', async () => {
    await getDocClient().send(
      new PutCommand({ TableName: getTableName(), Item: { PK: 'TEST#1', SK: '#META', hello: 'world' } }),
    );
    const res = await getDocClient().send(
      new GetCommand({ TableName: getTableName(), Key: { PK: 'TEST#1', SK: '#META' } }),
    );
    expect(res.Item).toMatchObject({ hello: 'world' });
  });
});
