export interface DbConfig {
  tableName: string;
  endpoint?: string;
  region: string;
}

export function loadDbConfig(): DbConfig {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  return {
    tableName: process.env.CLUB_NIGHT_TABLE ?? 'club-night',
    ...(endpoint ? { endpoint } : {}),
    region: process.env.AWS_REGION ?? 'eu-west-2',
  };
}
