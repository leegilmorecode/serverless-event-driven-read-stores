const INSERT = 'OrderCreated';
const MODIFY = 'OrderUpdated';
const REMOVE = 'OrderDeleted';

export const orderEventTypes: { [key: string]: string } = {
  INSERT,
  MODIFY,
  REMOVE,
};

export type EventMessage = {
  data: Record<string, any>;
  metadata: {
    eventType: string;
    service: string;
    domain: string;
  };
};

export type OrderCreate = {
  id: string;
  quantity: number;
  updated: string;
  created: string;
};

export type OrderUpdate = {
  quantity: number;
  updated: string;
};
