import * as AWS from 'aws-sdk';

import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';

import { v4 as uuid } from 'uuid';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'delete-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event?.pathParameters)
      throw new Error('no id in the path parameters of the event');

    const { id } = event.pathParameters;

    const ordersTable = process.env.TABLE_NAME as string;

    const params: AWS.DynamoDB.DocumentClient.DeleteItemInput = {
      TableName: ordersTable,
      Key: {
        id,
      },
    };

    console.log(`${prefix} - deleting order: ${id}`);

    await dynamoDb.delete(params).promise();

    return {
      statusCode: 204,
      body: JSON.stringify('No Content'),
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
};
