import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadDbConfig } from './config';

let docClient: DynamoDBDocumentClient | undefined;

export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const cfg = loadDbConfig();
    const base = new DynamoDBClient({
      region: cfg.region,
      ...(cfg.endpoint
        ? { endpoint: cfg.endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
        : {}),
    });
    docClient = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

export function getTableName(): string {
  return loadDbConfig().tableName;
}
