import * as AWS from 'aws-sdk';

import { DynamoDBStreamEvent, DynamoDBStreamHandler } from 'aws-lambda';
import { EventMessage, orderEventTypes } from '../../../../types';

import { PublishInput } from 'aws-sdk/clients/sns';
import { v4 as uuid } from 'uuid';

export const handler: DynamoDBStreamHandler = async (
  event: DynamoDBStreamEvent
): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = 'streamed-orders.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const snsTopic = process.env.SNS_TOPIC;
    console.log(`${prefix} - topic arn: ${snsTopic}`);

    // parse the records from the stream and unmarshall them before sending to sns
    for await (const record of event.Records) {
      if (!record.eventName || !record.dynamodb)
        throw new Error('event is not properly defined');

      const eventType: string = record.eventName;

      let item;

      switch (record.eventName) {
        case 'INSERT':
        case 'MODIFY':
          if (!record.dynamodb?.NewImage) throw new Error('malformed event');

          item = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);
          break;
        case 'REMOVE':
          if (!record.dynamodb?.OldImage) throw new Error('malformed event');

          item = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage);
          break;
        default:
          throw new Error('event type not found');
      }

      const message: EventMessage = {
        data: {
          ...item,
        },
        metadata: {
          eventType: orderEventTypes[eventType],
          service: 'orders-domain',
          domain: 'orders',
        },
      };

      console.log(`${prefix} - item: ${JSON.stringify(message)}`);

      const params: PublishInput = {
        Message: JSON.stringify(message),
        TopicArn: snsTopic,
        MessageGroupId: message.data.id,
      };
      await new AWS.SNS({ apiVersion: '2010-03-31' }).publish(params).promise();

      console.log(
        `${prefix} - message ${record.dynamodb.SequenceNumber} sent successfully`
      );
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
};
