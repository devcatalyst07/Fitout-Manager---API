import express from "express";
import { authMiddleware } from "../middleware/auth";
import * as messageService from "../services/messageService";

const router = express.Router();

// ─── Get team members eligible for messaging ────────────────────────────
router.get(
  "/members",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const adminId = await messageService.resolveAdminId(req.user!.id);
      if (!adminId) {
        return res.status(400).json({ message: "Unable to resolve team" });
      }

      const members = await messageService.getTeamMembers(adminId);
      // Exclude the requesting user from the list
      const others = members.filter((m) => m._id.toString() !== req.user!.id);
      res.json(others);
    } catch (error: any) {
      console.error("Get message members error:", error);
      res.status(500).json({ message: "Failed to fetch members" });
    }
  },
);

// ─── Get all conversations for the authenticated user ───────────────────
router.get(
  "/conversations",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const conversations = await messageService.getUserConversations(
        req.user!.id,
      );
      res.json(conversations);
    } catch (error: any) {
      console.error("Get conversations error:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  },
);

// ─── Get or create a direct conversation ────────────────────────────────
router.post(
  "/conversations/direct",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { targetUserId } = req.body;
      if (!targetUserId) {
        return res.status(400).json({ message: "targetUserId is required" });
      }

      const adminId = await messageService.resolveAdminId(req.user!.id);
      if (!adminId) {
        return res.status(400).json({ message: "Unable to resolve team" });
      }

      const conversation =
        await messageService.getOrCreateDirectConversation(
          req.user!.id,
          targetUserId,
          adminId,
        );

      // Populate participants before returning
      const populated = await conversation.populate(
        "participants",
        "name email role",
      );
      res.json(populated);
    } catch (error: any) {
      console.error("Create direct conversation error:", error);
      res.status(500).json({ message: "Failed to create conversation" });
    }
  },
);

// ─── Create a group conversation ────────────────────────────────────────
router.post(
  "/conversations/group",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { name, participantIds } = req.body;
      if (!name || !Array.isArray(participantIds) || participantIds.length < 1) {
        return res.status(400).json({
          message: "Group name and at least 1 other participant required",
        });
      }

      const adminId = await messageService.resolveAdminId(req.user!.id);
      if (!adminId) {
        return res.status(400).json({ message: "Unable to resolve team" });
      }

      const conversation = await messageService.createGroupConversation(
        name,
        participantIds,
        req.user!.id,
        adminId,
      );

      const populated = await conversation.populate(
        "participants",
        "name email role",
      );
      res.status(201).json(populated);
    } catch (error: any) {
      console.error("Create group conversation error:", error);
      res.status(500).json({ message: "Failed to create group" });
    }
  },
);

// ─── Search messages in a conversation (MUST BE BEFORE :conversationId/messages) ──
router.get(
  "/conversations/:conversationId/search",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { conversationId } = req.params;
      const query = (req.query.q as string) || "";
      const messages = await messageService.searchConversationMessages(
        conversationId,
        req.user!.id,
        query,
      );
      res.json(messages);
    } catch (error: any) {
      console.error("Search messages error:", error);
      res.status(500).json({ message: "Failed to search messages" });
    }
  },
);

// ─── Mark conversation as read ──────────────────────────────────────────
router.post(
  "/conversations/:conversationId/read",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { conversationId } = req.params;
      await messageService.markConversationRead(conversationId, req.user!.id);
      res.json({ message: "Marked as read" });
    } catch (error: any) {
      console.error("Mark read error:", error);
      res.status(500).json({ message: "Failed to mark as read" });
    }
  },
);

// ─── Mute/unmute conversation notifications ───────────────────────────
router.post(
  "/conversations/:conversationId/mute",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { conversationId } = req.params;
      const { muted } = req.body;
      const result = await messageService.setConversationMuted(
        conversationId,
        req.user!.id,
        Boolean(muted),
      );
      res.json(result);
    } catch (error: any) {
      console.error("Mute conversation error:", error);
      res.status(500).json({ message: "Failed to update mute status" });
    }
  },
);

// ─── Get messages for a conversation (paginated) ────────────────────────
router.get(
  "/conversations/:conversationId/messages",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { conversationId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const result = await messageService.getMessages(
        conversationId,
        page,
        limit,
      );
      res.json(result);
    } catch (error: any) {
      console.error("Get messages error:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  },
);

// ─── Send a message (REST fallback — primary sending via Socket) ────────
router.post(
  "/conversations/:conversationId/messages",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { conversationId } = req.params;
      const { text, attachments } = req.body;

      const cleanText = text?.trim();
      const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
      if (!cleanText && !hasAttachments) {
        return res.status(400).json({
          message: "Message text or attachments are required",
        });
      }

      const message = await messageService.sendMessage(
        conversationId,
        req.user!.id,
        cleanText || "",
        attachments,
      );

      res.status(201).json(message);
    } catch (error: any) {
      console.error("Send message error:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  },
);

export default router;
