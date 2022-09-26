import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as targets from 'aws-cdk-lib/aws-events-targets';

import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';

import { Construct } from 'constructs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export class StockStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ordersAccountId = this.node.tryGetContext('ordersAccountId');
    const sharedAccountId = this.node.tryGetContext('sharedAccountId');

    // create the dynamodb table for orders read store
    const ordersReadStoreTable: dynamodb.Table = new dynamodb.Table(
      this,
      'acme-orders-read-store-table',
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        tableName: 'acme-orders-read-store-table',
        contributorInsightsEnabled: true,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: 'id',
          type: dynamodb.AttributeType.STRING,
        },
      }
    );

    // create the stock event bus and archive
    const stockEventBus: events.EventBus = new events.EventBus(
      this,
      'acme-stock-event-bus',
      {
        eventBusName: 'acme-stock-event-bus',
      }
    );
    stockEventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);
    stockEventBus.archive('acme-stock-event-bus-archive', {
      archiveName: 'acme-stock-event-bus-archive',
      description: 'Acme Stock Bus Archive',
      eventPattern: {
        detailType: ['StockCreated'],
        account: [Stack.of(this).account],
      },
      retention: Duration.days(5),
    });

    stockEventBus._enableCrossEnvironment();

    // only allow events from the shared event bus directly i.e. shared bus --> stock local bus
    new events.CfnEventBusPolicy(this, 'CrossAccountEventBusPolicy', {
      eventBusName: stockEventBus.eventBusName,
      statementId: 'stock-event-bus-policy',
      statement: {
        Principal: { AWS: [sharedAccountId] },
        Action: 'events:PutEvents',
        Effect: 'Allow',
        Resource: stockEventBus.eventBusArn,
      },
    });

    // stock fifo dead letter queue for order updates
    const ordersFifoDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      'acme-orders-dlq.fifo',
      {
        queueName: 'acme-orders-dlq.fifo',
        fifo: true,
        removalPolicy: RemovalPolicy.DESTROY,
        encryption: sqs.QueueEncryption.KMS,
      }
    );

    // stock fifo queue for order updates
    const ordersFifoQueue: sqs.Queue = new sqs.Queue(
      this,
      'acme-orders-queue.fifo',
      {
        queueName: 'acme-orders-queue.fifo',
        fifo: true,
        removalPolicy: RemovalPolicy.DESTROY,
        contentBasedDeduplication: true,
        encryption: sqs.QueueEncryption.KMS,
        deduplicationScope: sqs.DeduplicationScope.QUEUE,
        deliveryDelay: Duration.seconds(0),
        visibilityTimeout: Duration.seconds(30),
        deadLetterQueue: {
          queue: ordersFifoDeadLetterQueue,
          maxReceiveCount: 10,
        },
      }
    );

    // get access to the orders sns topic and add a subscription from our FIFO queue
    const ordersSNSTopic = sns.Topic.fromTopicArn(
      this,
      `OrdersSNSTopic`,
      `arn:aws:sns:${this.region}:${ordersAccountId}:orders-sns-topic.fifo`
    );
    ordersSNSTopic.addSubscription(
      new subscriptions.SqsSubscription(ordersFifoQueue, {
        rawMessageDelivery: false,
      })
    );

    // create the 'orders-events' lambda for the sqs fifo queue to populate our read store
    const ordersEventsHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'orders-events-handler', {
        functionName: 'orders-events-handler',
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          '/../src/handlers/orders-events/orders-events.ts'
        ),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: ordersReadStoreTable.tableName,
        },
      });

    // allow the lambda to read the messages from sqs and write to the read store
    ordersReadStoreTable.grantWriteData(ordersEventsHandler);
    ordersEventsHandler.addEventSource(
      new SqsEventSource(ordersFifoQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );

    // allow the lambda to read from the queue
    ordersFifoQueue.grantConsumeMessages(ordersEventsHandler);

    // write all of the events to logs so we can track as a catch all
    const stockEventLogs: logs.LogGroup = new logs.LogGroup(
      this,
      'acme-stock-event-logs',
      {
        logGroupName: 'acme-stock-event-logs',
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // log all events to cloudwatch from the stock event bus
    new events.Rule(this, 'LogAllEventsToCloudwatch', {
      eventBus: stockEventBus,
      ruleName: 'LogAllEventsToCloudwatch',
      description: 'log all events on the stock event bus',
      eventPattern: {
        source: [{ prefix: '' }] as any[], // match all events
      },
      targets: [new targets.CloudWatchLogGroup(stockEventLogs)],
    });

    new cdk.CfnOutput(this, 'acmeOrdersFifoQueue', {
      value: ordersFifoQueue.queueArn,
      description: 'The arn of the acme stock sqs queue',
    });

    new cdk.CfnOutput(this, 'acmeStockEventBus', {
      value: stockEventBus.eventBusArn,
      description: 'The arn of the acme stock bus',
    });
  }
}
