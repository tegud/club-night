import { QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from './client';

/** Run a Query, following LastEvaluatedKey so no items are silently dropped past the 1 MB page limit. */
export async function queryAll(input: QueryCommandInput): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const res = await getDocClient().send(new QueryCommand({ ...input, ExclusiveStartKey: lastKey }));
    if (res.Items) items.push(...res.Items);
    lastKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);
  return items;
}
