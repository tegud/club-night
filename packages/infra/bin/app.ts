import { App } from 'aws-cdk-lib';
import { ClubNightStack } from '../src/club-night-stack';

const app = new App();
new ClubNightStack(app, 'ClubNightStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
