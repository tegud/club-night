import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { buildCreateTableInput } from '../../src/db/table';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'eu-west-2',
  endpoint: process.env.DYNAMODB_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

/** Drop and recreate the table so each test starts from a clean slate. */
export async function resetTable(): Promise<void> {
  const tableName = process.env.CLUB_NIGHT_TABLE ?? 'club-night-test';
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  // dynalite's delete is async even at deleteTableMs: 0 — retry until the
  // DELETING state clears and the CreateTable succeeds.
  const MAX_CREATE_ATTEMPTS = 20;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    try {
      await client.send(new CreateTableCommand(buildCreateTableInput(tableName)));
      break;
    } catch (err) {
      if (!(err instanceof ResourceInUseException)) throw err;
      if (attempt === MAX_CREATE_ATTEMPTS - 1)
        throw new Error(`resetTable: could not recreate table after ${MAX_CREATE_ATTEMPTS} attempts`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  // dynalite sets TableStatus = 'CREATING' and transitions to 'ACTIVE' via a
  // setTimeout (even at createTableMs: 0). Wait until ACTIVE before returning.
  const MAX_ACTIVE_WAIT_ATTEMPTS = 50;
  for (let attempt = 0; attempt < MAX_ACTIVE_WAIT_ATTEMPTS; attempt++) {
    const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (desc.Table?.TableStatus === 'ACTIVE') return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('resetTable: table did not become ACTIVE in time');
}
