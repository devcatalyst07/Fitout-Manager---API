import express from "express";
import { authMiddleware } from "../middleware/auth";
import Comment from "../models/Comment";
import Task from "../models/Task";
import ActivityLog from "../models/ActivityLog";
import TeamMember from "../models/TeamMember";
import { notifyProjectParticipants } from "../services/projectNotificationService";
import {
  addTaskClient,
  removeTaskClient,
  sendTaskEvent,
  sendTaskHeartbeat,
} from "../services/taskRealtimeService";

const router = express.Router();

const formatRealtimeComment = (comment: any) => {
  const user = comment?.userId;

  return {
    _id: comment?._id,
    taskId: comment?.taskId,
    userId: {
      _id: user?._id || comment?.userId,
      name: user?.name || comment?.userName || "Unknown User",
      email: user?.email || comment?.userEmail || "",
    },
    comment: comment?.comment || "",
    attachments: comment?.attachments || [],
    createdAt: comment?.createdAt,
    updatedAt: comment?.updatedAt,
  };
};

const formatRealtimeActivity = (log: any) => {
  const user = log?.userId;

  return {
    _id: log?._id,
    taskId: log?.taskId,
    type: log?.action || "updated",
    action: log?.action,
    description: log?.description || "",
    user: {
      _id: user?._id || log?.userId,
      name: user?.name || log?.userName || "Unknown User",
      email: user?.email || log?.userEmail || "",
    },
    timestamp: log?.createdAt,
    createdAt: log?.createdAt,
    metadata: {
      commentId: log?.commentId,
      field: log?.field,
      oldValue: log?.oldValue,
      newValue: log?.newValue,
    },
  };
};

router.get(
  "/:taskId/stream",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { taskId } = req.params;

      const task = await Task.findById(taskId).select("projectId assignees");
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      const isAdmin = req.user!.role === "admin";
      const isAssigned = task.assignees.some(
        (assignee) => assignee.email === req.user!.email,
      );
      const isProjectMember = await TeamMember.exists({
        projectId: task.projectId,
        userId: req.user!.id,
        status: "active",
      });

      if (!isAdmin && !isAssigned && !isProjectMember) {
        return res.status(403).json({
          message: "Not authorized to subscribe to this task stream",
        });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      addTaskClient(taskId, res);

      sendTaskEvent(taskId, "task:connected", {
        type: "connected",
      });

      const heartbeatInterval = setInterval(() => {
        sendTaskHeartbeat(taskId);
      }, 25000);

      req.on("close", () => {
        clearInterval(heartbeatInterval);
        removeTaskClient(taskId, res);
      });
    } catch (error: any) {
      console.error("Task realtime stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: error.message || "Failed to open task stream",
        });
      }
    }
  },
);

// GET all comments for a task
router.get(
  "/:taskId/comments",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { taskId } = req.params;

      const comments = await Comment.find({ taskId })
        .populate("userId", "name email")
        .sort({ createdAt: -1 });

      res.json(comments);
    } catch (error: any) {
      console.error("Get comments error:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch comments", error: error.message });
    }
  },
);

// CREATE new comment
router.post(
  "/:taskId/comments",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { taskId } = req.params;
      const { comment, attachments } = req.body;

      const hasCommentText =
        typeof comment === "string" && comment.trim() !== "";
      const hasAttachments =
        Array.isArray(attachments) && attachments.length > 0;

      if (!hasCommentText && !hasAttachments) {
        return res
          .status(400)
          .json({ message: "Comment or attachment is required" });
      }

      // Verify task exists
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      // Check if user is assigned to the task or is admin
      const userEmail = req.user!.email;
      const userRole = req.user!.role;

      const isAssigned = task.assignees.some(
        (assignee) => assignee.email === userEmail,
      );
      const isAdmin = userRole === "admin";

      if (!isAssigned && !isAdmin) {
        return res.status(403).json({
          message: "Only assigned members or admins can comment on this task",
        });
      }

      // Create comment
      const newComment = await Comment.create({
        taskId,
        userId: req.user!.id,
        userName: req.user!.name,
        userEmail: req.user!.email,
        comment: hasCommentText ? comment.trim() : "",
        attachments: attachments || [],
      });

      const createdActivityLog = await ActivityLog.create({
        taskId,
        commentId: newComment._id,
        userId: req.user!.id,
        userName: req.user!.name,
        userEmail: req.user!.email,
        action: "commented",
        description: `${req.user!.name} added a comment`,
      });

      const populatedComment = await Comment.findById(newComment._id).populate(
        "userId",
        "name email",
      );

      const activityLog = await ActivityLog.findById(createdActivityLog._id)
        .populate("userId", "name email");

      if (populatedComment) {
        sendTaskEvent(taskId, "task:comment:new", {
          type: "comment:new",
          comment: formatRealtimeComment(populatedComment),
        });
      }

      if (activityLog) {
        sendTaskEvent(taskId, "task:activity:new", {
          type: "activity:new",
          activity: formatRealtimeActivity(activityLog),
        });
      }

      if (task.projectId) {
        const taskTitle = (task as any).title || "a task";
        const trimmedComment = hasCommentText ? comment.trim() : "";
        const commentPreview = trimmedComment
          ? trimmedComment.length > 120
            ? `${trimmedComment.slice(0, 120)}...`
            : trimmedComment
          : "added attachments";

        await notifyProjectParticipants({
          projectId: task.projectId.toString(),
          actorId: req.user!.id,
          actorName: req.user!.name || "User",
          actorEmail: req.user!.email,
          title: "New task comment",
          message: `${req.user!.name || "User"} commented on \"${taskTitle}\": ${commentPreview}`,
          taskId,
          section: "tasks",
          extraRecipientEmails: (task.assignees || []).map(
            (assignee) => assignee.email,
          ),
          metadata: {
            taskId,
            taskTitle,
            activityAction: "task_comment_added",
            hasAttachments:
              Array.isArray(attachments) && attachments.length > 0,
          },
        });
      }

      res.status(201).json({
        message: "Comment added successfully",
        comment: populatedComment,
      });
    } catch (error: any) {
      console.error("Create comment error:", error);
      res
        .status(500)
        .json({ message: "Failed to create comment", error: error.message });
    }
  },
);

// DELETE comment
router.delete(
  "/:taskId/comments/:commentId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { commentId, taskId } = req.params;

      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({ message: "Comment not found" });
      }

      // Only comment owner or admin can delete
      if (
        comment.userId.toString() !== req.user!.id &&
        req.user!.role !== "admin"
      ) {
        return res
          .status(403)
          .json({ message: "Not authorized to delete this comment" });
      }

      await Comment.findByIdAndDelete(commentId);

      const linkedActivityLogs = await ActivityLog.find({
        taskId,
        commentId,
      }).select("_id");

      const linkedActivityIds = linkedActivityLogs.map((log) =>
        log._id.toString(),
      );

      if (linkedActivityIds.length > 0) {
        await ActivityLog.deleteMany({
          _id: { $in: linkedActivityIds },
        });
      }

      sendTaskEvent(taskId, "task:comment:deleted", {
        type: "comment:deleted",
        commentId,
      });

      if (linkedActivityIds.length > 0) {
        sendTaskEvent(taskId, "task:activity:deleted", {
          type: "activity:deleted",
          activityIds: linkedActivityIds,
        });
      }

      res.json({ message: "Comment deleted successfully" });
    } catch (error: any) {
      console.error("Delete comment error:", error);
      res
        .status(500)
        .json({ message: "Failed to delete comment", error: error.message });
    }
  },
);

export default router;
