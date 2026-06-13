import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { CfnOutput, CfnParameter, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import type { Construct } from 'constructs';

export class ClubNightStack extends Stack {
  readonly table: dynamodb.Table;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly scheduledFn: NodejsFunction;
  readonly apiFn: NodejsFunction;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      // RETAIN: survive `cdk destroy`; delete manually if truly decommissioning.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    for (const n of ['GSI1', 'GSI2', 'GSI3'] as const) {
      table.addGlobalSecondaryIndex({
        indexName: n,
        partitionKey: { name: `${n}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `${n}SK`, type: dynamodb.AttributeType.STRING },
      });
    }

    this.table = table;

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      // RETAIN: survive `cdk destroy`; delete manually if truly decommissioning.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { userPassword: true, userSrp: true },
      idTokenValidity: Duration.hours(8),
    });
    this.userPool = userPool;
    this.userPoolClient = userPoolClient;

    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const apiEntry = path.join(dirname, '../../api/src/handler.ts');
    const scheduledEntry = path.join(dirname, '../../api/src/scheduled-handler.ts');

    const guestJwtSecret = new CfnParameter(this, 'GuestJwtSecret', {
      type: 'String',
      noEcho: true,
      minLength: 32,
      description: 'HS256 secret (>=32 chars) for guest-session JWTs',
    });
    const emailFrom = new CfnParameter(this, 'EmailFrom', {
      type: 'String',
      description: 'A verified SES sender address',
    });
    // SES SendEmail is authorized on the verified "from" identity ARN (tighter than '*').
    const sesIdentityArn = `arn:aws:ses:${this.region}:${this.account}:identity/${emailFrom.valueAsString}`;

    const appEnv: Record<string, string> = {
      CLUB_NIGHT_TABLE: table.tableName,
      GUEST_JWT_SECRET: guestJwtSecret.valueAsString,
      EMAIL_FROM: emailFrom.valueAsString,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
    };
    const bundling = { externalModules: ['@aws-sdk/*'] };
    const fnDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: Duration.seconds(30),
      bundling,
    };

    const scheduledFn = new NodejsFunction(this, 'ScheduledPairingFn', {
      ...fnDefaults,
      entry: scheduledEntry,
      environment: appEnv,
    });
    table.grantReadWriteData(scheduledFn);
    scheduledFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [sesIdentityArn] }),
    );
    this.scheduledFn = scheduledFn;

    const apiFn = new NodejsFunction(this, 'ApiFn', {
      ...fnDefaults,
      entry: apiEntry,
      environment: appEnv,
    });
    table.grantReadWriteData(apiFn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [sesIdentityArn] }),
    );
    this.apiFn = apiFn;

    const SCHEDULE_GROUP_NAME = 'club-night';
    new scheduler.CfnScheduleGroup(this, 'ScheduleGroup', { name: SCHEDULE_GROUP_NAME });

    // Role the EventBridge Scheduler assumes to invoke the scheduled-pairing Lambda.
    const schedulerRole = new iam.Role(this, 'SchedulerInvokeRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    scheduledFn.grantInvoke(schedulerRole);

    // The API lambda needs the scheduler config + permission to create/delete schedules.
    apiFn.addEnvironment('SCHEDULER_GROUP', SCHEDULE_GROUP_NAME);
    apiFn.addEnvironment('SCHEDULER_TARGET_ARN', scheduledFn.functionArn);
    apiFn.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule'],
        resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/${SCHEDULE_GROUP_NAME}/*`],
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [schedulerRole.roleArn] }),
    );

    // authType NONE: the route layer validates Cognito/guest JWTs; the URL must be publicly reachable.
    const fnUrl = apiFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    new CfnOutput(this, 'ApiUrl', { value: fnUrl.url });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
