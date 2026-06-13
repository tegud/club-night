import { handle } from 'hono/aws-lambda';
import { assertAppConfig, assertSchedulerConfig } from './config/app-config';
import { createApp } from './app';

assertAppConfig();
assertSchedulerConfig();

export const handler = handle(createApp());
