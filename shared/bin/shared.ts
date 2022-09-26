#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { SharedStack } from '../lib/shared-stack';

const app = new cdk.App({
  context: {
    stockAccountId: '333333333333',
    ordersAccountId: '111111111111',
  },
});
new SharedStack(app, 'SharedStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
