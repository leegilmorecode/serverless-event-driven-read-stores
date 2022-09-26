import * as AWS from 'aws-sdk';

import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';

import { OrderUpdate } from '../../../../types';
import { v4 as uuid } from 'uuid';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'update-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event?.body) throw new Error('no body on the event');
    if (!event?.pathParameters)
      throw new Error('no id in the path parameters of the event');

    const { quantity } = JSON.parse(event.body);
    const { id } = event.pathParameters;

    const ordersTable = process.env.TABLE_NAME as string;

    const order: OrderUpdate = {
      quantity,
      updated: new Date().toISOString(),
    };

    const params: AWS.DynamoDB.DocumentClient.UpdateItemInput = {
      TableName: ordersTable,
      Key: {
        id,
      },
      ExpressionAttributeNames: { '#q': 'quantity', '#u': 'updated' },
      UpdateExpression: 'set #q = :q, #u = :u',
      ExpressionAttributeValues: {
        ':q': order.quantity,
        ':u': order.updated,
      },
    };

    console.log(`${prefix} - updating order: ${JSON.stringify(order)}`);

    await dynamoDb.update(params).promise();

    return {
      statusCode: 204,
      body: JSON.stringify(order),
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
};
