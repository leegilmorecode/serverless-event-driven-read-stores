#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { OrdersStack } from '../lib/orders-stack';

const app = new cdk.App({
  context: {
    sharedAccountId: '222222222222',
    stockAccountId: '333333333333',
  },
});
new OrdersStack(app, 'OrdersStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
