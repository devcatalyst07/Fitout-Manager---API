import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import Comment from "../models/Comment";
import Task from "../models/Task";
import ActivityLog from "../models/ActivityLog";

const router = Router();

// GET all comments for a task
router.get("/:taskId/comments", authMiddleware, async (req, res) => {
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
});

// CREATE new comment
router.post(
  "/:taskId/comments",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { taskId } = req.params;
      const { comment, attachments } = req.body;

      if (!comment || comment.trim() === "") {
        return res.status(400).json({ message: "Comment cannot be empty" });
      }

      // Verify task exists
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      // Check if user is assigned to the task or is admin
      const userEmail = req.user.email;
      const userRole = req.user.role;

      const isAssigned = task.assignees.some(
        (assignee) => assignee.email === userEmail
      );
      const isAdmin = userRole === "admin";

      if (!isAssigned && !isAdmin) {
        return res
          .status(403)
          .json({
            message: "Only assigned members or admins can comment on this task",
          });
      }

      // Create comment
      const newComment = await Comment.create({
        taskId,
        userId: req.user.id,
        userName: req.user.name,
        userEmail: req.user.email,
        comment,
        attachments: attachments || [],
      });

      // Log activity
      await ActivityLog.create({
        taskId,
        userId: req.user.id,
        userName: req.user.name,
        userEmail: req.user.email,
        action: "commented",
        description: `${req.user.name} added a comment`,
      });

      const populatedComment = await Comment.findById(newComment._id).populate(
        "userId",
        "name email"
      );

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
  }
);

// DELETE comment
router.delete(
  "/:taskId/comments/:commentId",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { commentId, taskId } = req.params;

      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({ message: "Comment not found" });
      }

      // Only comment owner or admin can delete
      if (
        comment.userId.toString() !== req.user.id &&
        req.user.role !== "admin"
      ) {
        return res
          .status(403)
          .json({ message: "Not authorized to delete this comment" });
      }

      await Comment.findByIdAndDelete(commentId);

      // Log activity
      await ActivityLog.create({
        taskId,
        userId: req.user.id,
        userName: req.user.name,
        userEmail: req.user.email,
        action: "updated",
        description: `${req.user.name} deleted a comment`,
      });

      res.json({ message: "Comment deleted successfully" });
    } catch (error: any) {
      console.error("Delete comment error:", error);
      res
        .status(500)
        .json({ message: "Failed to delete comment", error: error.message });
    }
  }
);

export default router;
