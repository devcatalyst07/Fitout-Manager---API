import { Response } from "express";

interface ThreadRealtimePayload {
  type: string;
  threadId: string;
  timestamp?: string;
  [key: string]: any;
}

interface SendThreadRealtimePayload {
  type: string;
  timestamp?: string;
  [key: string]: any;
}

const threadClients = new Map<string, Set<Response>>();

const writeEvent = (
  response: Response,
  event: string,
  payload: ThreadRealtimePayload,
) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

export const addThreadClient = (threadId: string, response: Response) => {
  const existing = threadClients.get(threadId) || new Set<Response>();
  existing.add(response);
  threadClients.set(threadId, existing);
};

export const removeThreadClient = (threadId: string, response: Response) => {
  const existing = threadClients.get(threadId);
  if (!existing) {
    return;
  }

  existing.delete(response);
  if (existing.size === 0) {
    threadClients.delete(threadId);
  }
};

export const sendThreadEvent = (
  threadId: string,
  event: string,
  payload: SendThreadRealtimePayload,
) => {
  const subscribers = threadClients.get(threadId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const { timestamp, ...restPayload } = payload;

  const eventPayload: ThreadRealtimePayload = {
    ...restPayload,
    threadId,
    timestamp: timestamp || new Date().toISOString(),
  };

  for (const response of subscribers) {
    try {
      writeEvent(response, event, eventPayload);
    } catch (error) {
      console.error("Thread realtime stream write error:", error);
      removeThreadClient(threadId, response);
    }
  }
};

export const sendThreadHeartbeat = (threadId: string) => {
  sendThreadEvent(threadId, "thread:heartbeat", {
    type: "heartbeat",
  });
};
