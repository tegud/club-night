import { describe, it, expect } from 'vitest';
import { TABLE_INDEXES, buildCreateTableInput } from '../../src/db/table';

describe('table schema', () => {
  it('names the three GSIs', () => {
    expect(TABLE_INDEXES).toEqual({ bySlug: 'GSI1', byUser: 'GSI2', byNightEmail: 'GSI3' });
  });

  it('builds a CreateTable input with PK/SK and three GSIs', () => {
    const input = buildCreateTableInput('club-night-test');
    expect(input.TableName).toBe('club-night-test');
    expect(input.BillingMode).toBe('PAY_PER_REQUEST');
    expect(input.KeySchema).toEqual([
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ]);
    expect(input.GlobalSecondaryIndexes).toHaveLength(3);
    const indexNames = input.GlobalSecondaryIndexes!.map((g) => g.IndexName).sort();
    expect(indexNames).toEqual(['GSI1', 'GSI2', 'GSI3']);
  });

  it('declares every key attribute used by the table and its indexes', () => {
    const input = buildCreateTableInput('club-night-test');
    const attrs = input.AttributeDefinitions!.map((a) => a.AttributeName).sort();
    expect(attrs).toEqual([
      'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'PK', 'SK',
    ]);
  });
});
