import * as AWS from 'aws-sdk';

import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';

import { OrderCreate } from '../../../../types';
import { v4 as uuid } from 'uuid';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'create-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event?.body) throw new Error('no body on the event');

    const { id, quantity } = JSON.parse(event.body);

    const ordersTable = process.env.TABLE_NAME as string;

    const order: OrderCreate = {
      id,
      quantity,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: ordersTable,
      Item: order,
    };

    console.log(`${prefix} - creating order: ${JSON.stringify(order)}`);

    await dynamoDb.put(params).promise();

    return {
      statusCode: 201,
      body: JSON.stringify(order),
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
};
