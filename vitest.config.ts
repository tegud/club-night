import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    globalSetup: ['packages/api/test/setup/global-setup.ts'],
    fileParallelism: false,
    env: {
      DYNAMODB_ENDPOINT: 'http://localhost:8000',
      CLUB_NIGHT_TABLE: 'club-night-test',
      AWS_REGION: 'eu-west-2',
    },
  },
});
