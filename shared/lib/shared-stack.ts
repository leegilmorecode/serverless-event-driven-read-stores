import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as logs from 'aws-cdk-lib/aws-logs';

import {
  CloudWatchLogGroup,
  EventBus as EventBusTarget,
} from 'aws-cdk-lib/aws-events-targets';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

import { Construct } from 'constructs';
import { EventBus } from 'aws-cdk-lib/aws-events';

export class SharedStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ordersAccountId = this.node.tryGetContext('ordersAccountId');
    const stockAccountId = this.node.tryGetContext('stockAccountId');

    // create the shared event bus and archive
    const sharedEventBus: events.EventBus = new events.EventBus(
      this,
      'acme-shared-event-bus',
      {
        eventBusName: 'acme-shared-event-bus',
      }
    );
    sharedEventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);
    sharedEventBus.archive('acme-shared-event-bus-archive', {
      archiveName: 'acme-shared-event-bus-archive',
      description: 'Acme Shared Bus Archive',
      eventPattern: {
        source: [{ prefix: '' }] as any[], //archive all events
      },
      retention: Duration.days(5),
    });

    sharedEventBus._enableCrossEnvironment();

    // create a shared event bus log group
    const sharedEventLogs: logs.LogGroup = new logs.LogGroup(
      this,
      'acme-shared-event-logs',
      {
        logGroupName: 'acme-shared-event-logs',
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // log all events to cloudwatch so we can track what is happening
    new events.Rule(this, 'LogAllEventsToCloudwatch', {
      eventBus: sharedEventBus,
      ruleName: 'LogAllEventsToCloudwatch',
      description: 'log all orders events',
      eventPattern: {
        source: [{ prefix: '' }] as any[], // Log all shared events
      },
      targets: [new CloudWatchLogGroup(sharedEventLogs)],
    });

    // create a policy to allow the other accounts to put events to the shared one directly
    new events.CfnEventBusPolicy(this, 'SharedBusPolicy', {
      eventBusName: sharedEventBus.eventBusName,
      statementId: 'global-bus-policy-stmt',
      statement: {
        // this is for each account which can post events to the shared bus
        Principal: { AWS: [ordersAccountId, stockAccountId] },
        Action: 'events:PutEvents',
        Resource: sharedEventBus.eventBusArn,
        Effect: 'Allow',
      },
    });

    // create a target rule for the orders event bus for any events apart from its own (prevent loops)
    const ordersRule = new events.Rule(this, 'SharedBusToOrders', {
      eventBus: sharedEventBus,
      ruleName: 'SharedBusToOrders',
      eventPattern: {
        account: [{ 'anything-but': ordersAccountId }] as any[],
      },
    });
    ordersRule.addTarget(
      new EventBusTarget(
        EventBus.fromEventBusArn(
          this,
          'OrdersBus',
          `arn:aws:events:${this.region}:${ordersAccountId}:event-bus/acme-orders-event-bus`
        )
      )
    );

    // create a target rule for the stock event bus for any events apart from its own (prevent loops)
    const stockRule = new events.Rule(this, 'SharedBusToStock', {
      eventBus: sharedEventBus,
      ruleName: 'SharedBusToStock',
      eventPattern: {
        account: [{ 'anything-but': stockAccountId }] as any[],
      },
    });
    stockRule.addTarget(
      new EventBusTarget(
        EventBus.fromEventBusArn(
          this,
          'StockBus',
          `arn:aws:events:${this.region}:${stockAccountId}:event-bus/acme-stock-event-bus`
        )
      )
    );

    new cdk.CfnOutput(this, 'acmeSharedEventBus', {
      value: sharedEventBus.eventBusArn,
      description: 'The arn of the acme shared bus',
    });
  }
}
