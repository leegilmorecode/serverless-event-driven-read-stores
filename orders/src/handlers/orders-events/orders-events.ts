import * as AWS from 'aws-sdk';

import { SQSEvent, SQSHandler } from 'aws-lambda';

import { v4 as uuid } from 'uuid';

const eventBridge = new AWS.EventBridge();

// we pull the events of the orders queue and raise the relevant eventbridge events
export const handler: SQSHandler = async ({
  Records,
}: SQSEvent): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = 'orders-events.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const eventBusName = process.env.SHARED_EVENT_BUS_ARN;

    console.log(
      `${prefix} - ${Records.length} record(s) to produce as events on ${eventBusName}`
    );

    // publish the events one at a time to the shared event bus
    for await (const record of Records) {
      const { Message: message } = JSON.parse(record.body);
      const paresedMessage = JSON.parse(message);

      const event: AWS.EventBridge.PutEventsRequestEntry = {
        Detail: message,
        DetailType: paresedMessage.metadata.eventType,
        EventBusName: eventBusName,
        Source: paresedMessage.metadata.service,
      };

      console.log(`${prefix} - event: ${JSON.stringify(event)}`);

      const orderEvent: AWS.EventBridge.PutEventsRequest = {
        Entries: [event],
      };

      const result: AWS.EventBridge.PutEventsResponse = await eventBridge
        .putEvents(orderEvent)
        .promise();

      console.log(`${prefix} - result: ${JSON.stringify(result)}`);
    }

    console.log(`${prefix} - completed batch successfully`);
  } catch (error) {
    console.error(error);
    throw error;
  }
};
