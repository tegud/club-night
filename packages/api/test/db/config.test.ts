import { describe, it, expect, afterEach } from 'vitest';
import { loadDbConfig } from '../../src/db/config';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('loadDbConfig', () => {
  it('reads table name, endpoint and region from the environment', () => {
    process.env.CLUB_NIGHT_TABLE = 'my-table';
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
    process.env.AWS_REGION = 'eu-west-2';
    expect(loadDbConfig()).toEqual({
      tableName: 'my-table',
      endpoint: 'http://localhost:8000',
      region: 'eu-west-2',
    });
  });

  it('defaults region and leaves endpoint undefined when unset', () => {
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.AWS_REGION;
    process.env.CLUB_NIGHT_TABLE = 'club-night';
    const cfg = loadDbConfig();
    expect(cfg.endpoint).toBeUndefined();
    expect(cfg.region).toBe('eu-west-2');
  });
});
