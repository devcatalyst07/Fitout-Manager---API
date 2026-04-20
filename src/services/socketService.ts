import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { securityConfig } from "../config/security";
import { getAllowedOrigins } from "../config/security";
import * as messageService from "../services/messageService";
import cookie from "cookie";

let io: Server | null = null;

/** Initialise Socket.IO on the provided HTTP server. */
export const initSocketIO = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // ── Auth middleware ─────────────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie || "");
      const token = cookies[securityConfig.cookies.session.name];

      if (!token) return next(new Error("AUTH_TOKEN_MISSING"));

      const decoded = jwt.verify(token, securityConfig.jwt.accessSecret) as {
        id: string;
        email: string;
        role: string;
        name: string;
      };

      (socket as any).userId = decoded.id;
      (socket as any).userName = decoded.name;
      (socket as any).userEmail = decoded.email;
      next();
    } catch {
      next(new Error("AUTH_TOKEN_INVALID"));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    const userId: string = (socket as any).userId;
    const userName: string = (socket as any).userName;

    // Join a personal room so we can target this user
    socket.join(`user:${userId}`);
    console.log(`🔌 Socket connected: ${userName} (${userId})`);

    // ── Join conversation rooms ────────────────────────────────────
    socket.on("join:conversation", (conversationId: string) => {
      socket.join(`convo:${conversationId}`);
    });

    socket.on("leave:conversation", (conversationId: string) => {
      socket.leave(`convo:${conversationId}`);
    });

    // ── Send message via socket ────────────────────────────────────
    socket.on(
      "message:send",
      async (
        data: { conversationId: string; text: string; attachments?: any[] },
        ack?: (resp: any) => void,
      ) => {
        try {
          const text = data.text?.trim() || "";
          const hasAttachments = Array.isArray(data.attachments) &&
            data.attachments.length > 0;
          if (!text && !hasAttachments) return;

          const message = await messageService.sendMessage(
            data.conversationId,
            userId,
            text,
            data.attachments,
          );

          // Broadcast to all participants in the conversation room
          io!.to(`convo:${data.conversationId}`).emit("message:new", message);

          // Also push a lightweight event to each participant's personal room
          // so their conversation list updates even if they haven't joined
          const conversationModule = await import("../models/Conversation.js");
          const ConversationModel = (conversationModule as any).default;
          const convo = await ConversationModel.findById(data.conversationId).lean();

          if (convo) {
            const mutedBy = Array.isArray((convo as any).mutedBy)
              ? (convo as any).mutedBy.map((id: any) => id.toString())
              : [];
            for (const pid of convo.participants) {
              const pidStr = pid.toString();
              if (pidStr !== userId && !mutedBy.includes(pidStr)) {
                io!.to(`user:${pidStr}`).emit("conversation:updated", {
                  conversationId: data.conversationId,
                  lastMessage: message,
                });
              }
            }
          }

          if (ack) ack({ ok: true, message });
        } catch (error) {
          console.error("Socket message:send error:", error);
          if (ack) ack({ ok: false, error: "Failed to send message" });
        }
      },
    );

    // ── Typing indicators ──────────────────────────────────────────
    socket.on("typing:start", (conversationId: string) => {
      socket.to(`convo:${conversationId}`).emit("typing:start", {
        conversationId,
        userId,
        userName,
      });
    });

    socket.on("typing:stop", (conversationId: string) => {
      socket.to(`convo:${conversationId}`).emit("typing:stop", {
        conversationId,
        userId,
      });
    });

    // ── Mark read ──────────────────────────────────────────────────
    socket.on("message:read", async (conversationId: string) => {
      try {
        await messageService.markConversationRead(conversationId, userId);
        socket.to(`convo:${conversationId}`).emit("message:read", {
          conversationId,
          userId,
        });
      } catch (error) {
        console.error("Socket message:read error:", error);
      }
    });

    // ── Disconnect ─────────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected: ${userName} (${userId})`);
    });
  });

  return io;
};

/** Get the current Socket.IO server instance. */
export const getIO = (): Server | null => io;
