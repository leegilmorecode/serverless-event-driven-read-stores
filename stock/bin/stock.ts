#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { StockStack } from '../lib/stock-stack';

const app = new cdk.App({
  context: {
    sharedAccountId: '222222222222',
    ordersAccountId: '111111111111',
  },
});
new StockStack(app, 'StockStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
