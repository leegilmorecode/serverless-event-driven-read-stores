import * as AWS from 'aws-sdk';

import { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda';

import { EventMessage } from '../../../../types';
import { v4 as uuid } from 'uuid';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// we pull the events of the orders queue and write to the read store
export const handler: SQSHandler = async ({
  Records,
}: SQSEvent): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = 'orders-events-read-store.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const ordersReadStoreTable = process.env.TABLE_NAME;

    if (!ordersReadStoreTable) throw new Error('table config not supplied');
    if (Records.length > 1) throw new Error('batch size should be set to 1');

    // batch size will always be 1 so we can ensure order updates are done in the correct order
    const record: SQSRecord = Records[0];

    const { Message: message } = JSON.parse(record.body);

    const orderUpdate: EventMessage = JSON.parse(message);

    console.log(`${prefix} - event: ${JSON.stringify(orderUpdate)}`);

    const { data, metadata } = orderUpdate;

    if (
      metadata.eventType === 'OrderCreated' ||
      metadata.eventType === 'OrderUpdated'
    ) {
      // for order create or update events we use a put item and replace the full item
      const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
        TableName: ordersReadStoreTable,
        Item: data,
      };

      await dynamoDb.put(params).promise();
    }

    if (metadata.eventType === 'OrderDeleted') {
      // for a delete we delete the item from the table
      const params: AWS.DynamoDB.DocumentClient.DeleteItemInput = {
        TableName: ordersReadStoreTable,
        Key: {
          id: data.id,
        },
      };

      await dynamoDb.delete(params).promise();
    }
  } catch (error) {
    console.log(error);
    throw error;
  }
};
