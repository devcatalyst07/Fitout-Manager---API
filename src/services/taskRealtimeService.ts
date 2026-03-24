import { Response } from "express";

interface TaskRealtimePayload {
  type: string;
  taskId: string;
  timestamp?: string;
  [key: string]: any;
}

interface SendTaskRealtimePayload {
  type: string;
  timestamp?: string;
  [key: string]: any;
}

const taskClients = new Map<string, Set<Response>>();

const writeEvent = (
  response: Response,
  event: string,
  payload: TaskRealtimePayload,
) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

export const addTaskClient = (taskId: string, response: Response) => {
  const existing = taskClients.get(taskId) || new Set<Response>();
  existing.add(response);
  taskClients.set(taskId, existing);
};

export const removeTaskClient = (taskId: string, response: Response) => {
  const existing = taskClients.get(taskId);
  if (!existing) {
    return;
  }

  existing.delete(response);
  if (existing.size === 0) {
    taskClients.delete(taskId);
  }
};

export const sendTaskEvent = (
  taskId: string,
  event: string,
  payload: SendTaskRealtimePayload,
) => {
  const subscribers = taskClients.get(taskId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const { timestamp, ...restPayload } = payload;

  const eventPayload: TaskRealtimePayload = {
    ...restPayload,
    taskId,
    timestamp: timestamp || new Date().toISOString(),
  };

  for (const response of subscribers) {
    try {
      writeEvent(response, event, eventPayload);
    } catch (error) {
      console.error("Task realtime stream write error:", error);
      removeTaskClient(taskId, response);
    }
  }
};

export const sendTaskHeartbeat = (taskId: string) => {
  sendTaskEvent(taskId, "task:heartbeat", {
    type: "heartbeat",
  });
};
