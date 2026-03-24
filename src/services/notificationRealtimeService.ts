import { Response } from "express";

interface RealtimeNotificationPayload {
  type: string;
  notification?: any;
  unreadCount?: number;
  timestamp?: string;
}

const clients = new Map<string, Set<Response>>();

const writeEvent = (
  response: Response,
  event: string,
  payload: RealtimeNotificationPayload,
) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

export const addNotificationClient = (userId: string, response: Response) => {
  const existing = clients.get(userId) || new Set<Response>();
  existing.add(response);
  clients.set(userId, existing);
};

export const removeNotificationClient = (
  userId: string,
  response: Response,
) => {
  const existing = clients.get(userId);
  if (!existing) {
    return;
  }

  existing.delete(response);
  if (existing.size === 0) {
    clients.delete(userId);
  }
};

export const sendNotificationEvent = (
  userId: string,
  event: string,
  payload: RealtimeNotificationPayload,
) => {
  const subscribers = clients.get(userId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  for (const response of subscribers) {
    try {
      writeEvent(response, event, payload);
    } catch (error) {
      console.error("Notification realtime stream write error:", error);
      removeNotificationClient(userId, response);
    }
  }
};

export const sendHeartbeat = (userId: string) => {
  sendNotificationEvent(userId, "heartbeat", {
    type: "heartbeat",
    timestamp: new Date().toISOString(),
  });
};
