import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as targets from 'aws-cdk-lib/aws-events-targets';

import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  DynamoEventSource,
  SqsDlq,
} from 'aws-cdk-lib/aws-lambda-event-sources';

import { Construct } from 'constructs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export class OrdersStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const sharedAccountId = this.node.tryGetContext('sharedAccountId');
    const stockAccountId = this.node.tryGetContext('stockAccountId');

    const sharedEventBusArn = `arn:aws:events:${this.region}:${sharedAccountId}:event-bus/acme-shared-event-bus`;

    // create the dynamodb table for orders
    const ordersTable: dynamodb.Table = new dynamodb.Table(
      this,
      'acme-orders-table',
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        tableName: 'acme-orders-table',
        contributorInsightsEnabled: true,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: 'id',
          type: dynamodb.AttributeType.STRING,
        },
        stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      }
    );

    // create the rest API for orders
    const ordersApi: apigw.RestApi = new apigw.RestApi(
      this,
      'acme-orders-api',
      {
        description: 'acme orders api',
        deploy: true,
        deployOptions: {
          stageName: 'prod',
          dataTraceEnabled: true,
          loggingLevel: apigw.MethodLoggingLevel.INFO,
          tracingEnabled: true,
          metricsEnabled: true,
        },
      }
    );

    // create the orders sns topic which the lambda publishes too
    const acmeOrdersSnsTopic = new sns.Topic(this, 'orders-sns-topic', {
      fifo: true,
      topicName: 'orders-sns-topic.fifo',
      displayName: 'orders-sns-topic.fifo',
      contentBasedDeduplication: true,
    });
    acmeOrdersSnsTopic.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // allow subscribe from the stock account
    // note you could do this on an organisational level too
    acmeOrdersSnsTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'stock-account-orders-sns-subscribe',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal(stockAccountId)],
        actions: ['sns:Subscribe'],
        resources: [acmeOrdersSnsTopic.topicArn],
      })
    );

    // streamed orders lambda handler
    const streamedOrdersHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'acme-streamed-orders-handler', {
        functionName: 'acme-streamed-orders-handler',
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          '/../src/handlers/streamed-orders/streamed-orders.ts'
        ),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          SNS_TOPIC: acmeOrdersSnsTopic.topicArn,
        },
      });

    const ordersStreamDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      'acme-orders-stream-dlq',
      {
        removalPolicy: RemovalPolicy.DESTROY,
        queueName: 'acme-orders-stream-dlq',
      }
    );

    // add the dynamodb streams to invoke the lambda to produce events on eventbridge
    streamedOrdersHandler.addEventSource(
      new DynamoEventSource(ordersTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 10,
        bisectBatchOnError: true,
        onFailure: new SqsDlq(ordersStreamDeadLetterQueue),
        retryAttempts: 10000,
      })
    );

    // allow the streamed orders lambda to publish to sns
    acmeOrdersSnsTopic.grantPublish(streamedOrdersHandler);
    ordersTable.grantStreamRead(streamedOrdersHandler);

    // add a /orders resource
    const orders: apigw.Resource = ordersApi.root.addResource('orders');
    const order = orders.addResource('{id}');

    // create order lambda handler
    const createLambdaHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'acme-create-order-handler', {
        functionName: 'acme-create-order-handler',
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          '/../src/handlers/create-order/create-order.ts'
        ),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: ordersTable.tableName,
        },
      });

    // update order lambda handler
    const updateLambdaHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'acme-update-order-handler', {
        functionName: 'acme-update-order-handler',
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          '/../src/handlers/update-order/update-order.ts'
        ),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: ordersTable.tableName,
        },
      });

    // delete order lambda handler
    const deleteLambdaHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'acme-delete-order-handler', {
        functionName: 'acme-delete-order-handler',
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          '/../src/handlers/delete-order/delete-order.ts'
        ),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: ordersTable.tableName,
        },
      });

    // allow the lambdas to create/update/delete items in the table
    ordersTable.grantWriteData(createLambdaHandler);
    ordersTable.grantWriteData(updateLambdaHandler);
    ordersTable.grantWriteData(deleteLambdaHandler);

    // integrate the lambda to the method - PATCH /orders/{id} (i.e. update order)
    order.addMethod(
      'PATCH',
      new apigw.LambdaIntegration(updateLambdaHandler, {
        proxy: true,
        allowTestInvoke: false,
      })
    );

    // integrate the lambda to the method - DELETE /orders/{id} (i.e. delete order)
    order.addMethod(
      'DELETE',
      new apigw.LambdaIntegration(deleteLambdaHandler, {
        proxy: true,
        allowTestInvoke: false,
      })
    );

    // integrate the lambda to the method - POST /orders/ (i.e. create order)
    orders.addMethod(
      'POST',
      new apigw.LambdaIntegration(createLambdaHandler, {
        proxy: true,
        allowTestInvoke: false,
      })
    );

    // create the orders event bus and archive
    const ordersEventBus: events.EventBus = new events.EventBus(
      this,
      'acme-orders-event-bus',
      {
        eventBusName: 'acme-orders-event-bus',
      }
    );
    ordersEventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);
    ordersEventBus.archive('acme-orders-event-bus-archive', {
      archiveName: 'acme-orders-event-bus-archive',
      description: 'Acme Orders Bus Archive',
      eventPattern: {
        detailType: ['OrderCreated', 'OrderUpdated', 'OrderDeleted'],
        account: [Stack.of(this).account],
      },
      retention: Duration.days(5),
    });

    ordersEventBus._enableCrossEnvironment();

    // only allow events from the shared event bus directly i.e. shared bus --> orders local bus
    new events.CfnEventBusPolicy(this, 'CrossAccountEventBusPolicy', {
      eventBusName: ordersEventBus.eventBusName,
      statementId: 'orders-event-bus-policy',
      statement: {
        Principal: { AWS: [sharedAccountId] },
        Action: 'events:PutEvents',
        Effect: 'Allow',
        Resource: ordersEventBus.eventBusArn,
      },
    });

    // write all of the events to logs so we can track as a catch all
    const ordersEventLogs: logs.LogGroup = new logs.LogGroup(
      this,
      'acme-orders-event-logs',
      {
        logGroupName: 'acme-orders-event-logs',
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // log all events to cloudwatch from the orders event bus
    new events.Rule(this, 'LogAllEventsToCloudwatch', {
      eventBus: ordersEventBus,
      ruleName: 'LogAllEventsToCloudwatch',
      description: 'log all orders events',
      eventPattern: {
        source: [{ prefix: '' }] as any[], // match all events
      },
      targets: [new targets.CloudWatchLogGroup(ordersEventLogs)],
    });

    // dead letter queue for order updates lambda
    const ordersDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      'acme-orders-dlq.fifo',
      {
        queueName: 'acme-orders-dlq.fifo',
        removalPolicy: RemovalPolicy.DESTROY,
        encryption: sqs.QueueEncryption.KMS,
        fifo: true,
      }
    );

    // orders fifo queue for order updates subscribed to sns topic
    const ordersFifoQueue: sqs.Queue = new sqs.Queue(this, 'acme-orders.fifo', {
      queueName: 'acme-orders.fifo',
      fifo: true,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: sqs.QueueEncryption.KMS,
      contentBasedDeduplication: true,
      deadLetterQueue: {
        queue: ordersDeadLetterQueue,
        maxReceiveCount: 10,
      },
    });

    // add the subscription of the fifo queue to the sns topic
    acmeOrdersSnsTopic.addSubscription(
      new subscriptions.SqsSubscription(ordersFifoQueue)
    );

    // create the 'orders-events' lambda for the sqs fifo queue to push events to eventbridge
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
          SHARED_EVENT_BUS_ARN: sharedEventBusArn,
        },
      });

    ordersEventsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [sharedEventBusArn],
      })
    );

    // add the lambda event source for the orders fifo queue
    ordersEventsHandler.addEventSource(
      new SqsEventSource(ordersFifoQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );

    // allow the lambda to read from the queue and write to the orders event bus
    ordersFifoQueue.grantConsumeMessages(ordersEventsHandler);

    new cdk.CfnOutput(this, 'acmeOrdersSnsTopicArn', {
      value: acmeOrdersSnsTopic.topicArn,
      description: 'The arn of the acme orders sns topic',
    });
  }
}
