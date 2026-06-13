import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ClubNightStack } from '../src/club-night-stack';

function synth(): Template {
  // Disable Lambda bundling during synth so tests are fast and need no esbuild/Docker run.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new ClubNightStack(app, 'TestStack');
  return Template.fromStack(stack);
}

describe('ClubNightStack', () => {
  it('synthesizes', () => {
    expect(() => synth()).not.toThrow();
  });
});

describe('DynamoDB table', () => {
  it('is a single PAY_PER_REQUEST table with TTL on `ttl`', () => {
    const t = synth();
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      KeySchema: Match.arrayWith([
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ]),
    });
  });

  it('defines three GSIs (GSI1, GSI2, GSI3)', () => {
    const t = synth();
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'GSI1' }),
        Match.objectLike({ IndexName: 'GSI2' }),
        Match.objectLike({ IndexName: 'GSI3' }),
      ]),
    });
  });
});

describe('Cognito', () => {
  it('creates a user pool and an app client', () => {
    const t = synth();
    t.resourceCountIs('AWS::Cognito::UserPool', 1);
    t.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });
});

describe('API URL, scheduler, and wiring', () => {
  it('exposes the API via a public Function URL', () => {
    const t = synth();
    t.resourceCountIs('AWS::Lambda::Url', 1);
    t.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
  });

  it('creates an EventBridge Scheduler group', () => {
    const t = synth();
    t.resourceCountIs('AWS::Scheduler::ScheduleGroup', 1);
  });

  it('creates a role the scheduler service can assume', () => {
    const t = synth();
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Principal: { Service: 'scheduler.amazonaws.com' } }),
        ]),
      }),
    });
  });

  it('grants the API lambda permission to create/delete schedules', () => {
    const t = synth();
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(['scheduler:CreateSchedule', 'scheduler:DeleteSchedule']) }),
        ]),
      }),
    });
  });

  it('puts the scheduler env on exactly one function (the API lambda)', () => {
    const t = synth();
    const fns = t.findResources('AWS::Lambda::Function');
    const withScheduler = Object.values(fns).filter(
      (f) => (f as any).Properties?.Environment?.Variables?.SCHEDULER_TARGET_ARN !== undefined,
    );
    expect(withScheduler).toHaveLength(1);
  });
});

describe('Lambdas', () => {
  it('creates two Node 20 functions', () => {
    const t = synth();
    t.resourceCountIs('AWS::Lambda::Function', 2);
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
    });
  });

  it('passes core env to the functions', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ CLUB_NIGHT_TABLE: Match.anyValue(), COGNITO_USER_POOL_ID: Match.anyValue() }) },
    });
  });
});
