import express from "express";
import mongoose from "mongoose";
import { authMiddleware } from "../middleware/auth";
import Brand from "../models/Brand";
import Project from "../models/Projects";
import TeamMember from "../models/TeamMember";
import Thread from "../models/Thread";
import ThreadComment from "../models/ThreadComment";
import ThreadReaction, {
  REACTION_TYPES,
  ReactionType,
} from "../models/ThreadReaction";

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildReactionSummary(
  reactions: Array<{ reaction: string; authorName: string }>
) {
  const summary: Record<string, { count: number; users: string[] }> = {};
  for (const r of reactions) {
    if (!summary[r.reaction]) summary[r.reaction] = { count: 0, users: [] };
    summary[r.reaction].count++;
    summary[r.reaction].users.push(r.authorName);
  }
  return summary;
}

async function checkBrandAccess(
  user: Express.Request["user"],
  brandId: string
) {
  if (!user) return null;
  if (!mongoose.Types.ObjectId.isValid(brandId)) return null;

  const brand = await Brand.findById(brandId);
  if (!brand || !brand.isActive) return null;

  if (user.role === "admin") {
    if (brand.createdBy.toString() !== user.id.toString()) return null;
    return brand;
  }

  const project = await Project.findOne({ brand: brand.name });
  if (!project) return null;

  const membership = await TeamMember.findOne({
    userId: user.id,
    projectId: project._id,
    status: "active",
  });

  return membership ? brand : null;
}

// ─── GET /api/threads?brandId=xxx&page=1&limit=20 ────────────────────────────

router.get(
  "/",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { brandId } = req.query as { brandId?: string };

      if (!brandId) {
        return res.status(400).json({ message: "brandId is required" });
      }

      const brand = await checkBrandAccess(req.user!, brandId);
      if (!brand) {
        return res.status(403).json({ message: "Access denied to this brand" });
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(
        50,
        Math.max(1, parseInt(req.query.limit as string) || 20)
      );
      const skip = (page - 1) * limit;

      const filter = { brandId, deletedAt: null };

      const [posts, total] = await Promise.all([
        Thread.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Thread.countDocuments(filter),
      ]);

      const postIds = posts.map((p) => p._id);

      const [commentCounts, allReactions] = await Promise.all([
        ThreadComment.aggregate([
          { $match: { threadId: { $in: postIds }, deletedAt: null } },
          { $group: { _id: "$threadId", count: { $sum: 1 } } },
        ]),
        ThreadReaction.find({
          targetType: "post",
          targetId: { $in: postIds },
        }).lean(),
      ]);

      const commentCountMap: Record<string, number> = {};
      for (const c of commentCounts) {
        commentCountMap[c._id.toString()] = c.count;
      }

      const reactionsByPost: Record<
        string,
        Array<{ reaction: string; authorName: string; userId: string }>
      > = {};
      for (const r of allReactions) {
        const key = r.targetId.toString();
        if (!reactionsByPost[key]) reactionsByPost[key] = [];
        reactionsByPost[key].push({
          reaction: r.reaction,
          authorName: r.authorName,
          userId: r.userId.toString(),
        });
      }

      const enrichedPosts = posts.map((post) => {
        const postId = post._id.toString();
        const reactions = reactionsByPost[postId] || [];
        return {
          ...post,
          commentCount: commentCountMap[postId] || 0,
          reactionSummary: buildReactionSummary(reactions),
          myReaction:
            reactions.find((r) => r.userId === req.user!.id.toString())
              ?.reaction ?? null,
        };
      });

      res.json({
        posts: enrichedPosts,
        total,
        page,
        limit,
        hasMore: skip + posts.length < total,
      });
    } catch (err) {
      console.error("Threads: get posts error:", err);
      res.status(500).json({ message: "Failed to fetch threads" });
    }
  }
);

// ─── POST /api/threads ────────────────────────────────────────────────────────

router.post(
  "/",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { brandId, content } = req.body;

      if (!brandId) {
        return res.status(400).json({ message: "brandId is required" });
      }
      if (!content || !content.trim()) {
        return res.status(400).json({ message: "Content cannot be empty" });
      }
      if (content.trim().length > 5000) {
        return res
          .status(400)
          .json({ message: "Content cannot exceed 5000 characters" });
      }

      const brand = await checkBrandAccess(req.user!, brandId);
      if (!brand) {
        return res.status(403).json({ message: "Access denied to this brand" });
      }

      const adminId =
        req.user!.role === "admin"
          ? req.user!.id
          : (brand.createdBy as mongoose.Types.ObjectId).toString();

      const post = await Thread.create({
        brandId,
        brandName: brand.name,
        adminId,
        userId: req.user!.id,
        // ✅ FIX: fallback to email if name is missing in the user record
        authorName: req.user!.name || req.user!.email,
        authorEmail: req.user!.email,
        authorRole: req.user!.role,
        content: content.trim(),
      });

      res.status(201).json({
        message: "Post created successfully",
        post: {
          ...post.toObject(),
          commentCount: 0,
          reactionSummary: {},
          myReaction: null,
        },
      });
    } catch (err) {
      console.error("Threads: create post error:", err);
      res.status(500).json({ message: "Failed to create post" });
    }
  }
);

// ─── POST /api/threads/reactions/toggle ──────────────────────────────────────
// NOTE: Must be declared BEFORE /:id routes to avoid param collision

router.post(
  "/reactions/toggle",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { targetType, targetId, reaction, brandId } = req.body;

      if (!["post", "comment"].includes(targetType)) {
        return res
          .status(400)
          .json({ message: 'targetType must be "post" or "comment"' });
      }
      if (!mongoose.Types.ObjectId.isValid(targetId)) {
        return res.status(400).json({ message: "Invalid targetId" });
      }
      if (!REACTION_TYPES.includes(reaction as ReactionType)) {
        return res.status(400).json({
          message: `reaction must be one of: ${REACTION_TYPES.join(", ")}`,
        });
      }

      const brand = await checkBrandAccess(req.user!, brandId);
      if (!brand) {
        return res.status(403).json({ message: "Access denied" });
      }

      const adminId =
        req.user!.role === "admin"
          ? req.user!.id
          : (brand.createdBy as mongoose.Types.ObjectId).toString();

      const existing = await ThreadReaction.findOne({
        targetId,
        userId: req.user!.id,
      });

      let action: "added" | "removed" | "switched";

      if (!existing) {
        await ThreadReaction.create({
          brandId,
          adminId,
          userId: req.user!.id,
          // ✅ FIX: fallback to email if name is missing
          authorName: req.user!.name || req.user!.email,
          targetType,
          targetId,
          reaction,
        });
        action = "added";
      } else if (existing.reaction === reaction) {
        await existing.deleteOne();
        action = "removed";
      } else {
        existing.reaction = reaction as ReactionType;
        await existing.save();
        action = "switched";
      }

      const allReactions = await ThreadReaction.find({ targetId }).lean();
      const summary = buildReactionSummary(allReactions);
      const myReaction =
        allReactions.find(
          (r) => r.userId.toString() === req.user!.id.toString()
        )?.reaction ?? null;

      res.json({ action, targetId, targetType, summary, myReaction });
    } catch (err) {
      console.error("Threads: toggle reaction error:", err);
      res.status(500).json({ message: "Failed to toggle reaction" });
    }
  }
);

// ─── PUT /api/threads/:id ─────────────────────────────────────────────────────

router.put(
  "/:id",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid post ID" });
      }

      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ message: "Content cannot be empty" });
      }
      if (content.trim().length > 5000) {
        return res
          .status(400)
          .json({ message: "Content cannot exceed 5000 characters" });
      }

      const post = await Thread.findOne({ _id: id, deletedAt: null });
      if (!post) return res.status(404).json({ message: "Post not found" });

      const isOwner = post.userId.toString() === req.user!.id.toString();
      const isAdmin = req.user!.role === "admin";
      if (!isOwner && !isAdmin) {
        return res
          .status(403)
          .json({ message: "You can only edit your own posts" });
      }

      post.content = content.trim();
      post.isEdited = true;
      await post.save();

      res.json({ message: "Post updated successfully", post });
    } catch (err) {
      console.error("Threads: update post error:", err);
      res.status(500).json({ message: "Failed to update post" });
    }
  }
);

// ─── DELETE /api/threads/:id ──────────────────────────────────────────────────

router.delete(
  "/:id",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid post ID" });
      }

      const post = await Thread.findOne({ _id: id, deletedAt: null });
      if (!post) return res.status(404).json({ message: "Post not found" });

      const isOwner = post.userId.toString() === req.user!.id.toString();
      const isAdmin = req.user!.role === "admin";
      if (!isOwner && !isAdmin) {
        return res
          .status(403)
          .json({ message: "You can only delete your own posts" });
      }

      post.deletedAt = new Date();
      await post.save();

      res.json({ message: "Post deleted successfully", postId: id });
    } catch (err) {
      console.error("Threads: delete post error:", err);
      res.status(500).json({ message: "Failed to delete post" });
    }
  }
);

// ─── GET /api/threads/:id/comments ───────────────────────────────────────────

router.get(
  "/:id/comments",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid post ID" });
      }

      const post = await Thread.findOne({ _id: id, deletedAt: null }).lean();
      if (!post) return res.status(404).json({ message: "Post not found" });

      const brand = await checkBrandAccess(req.user!, post.brandId.toString());
      if (!brand) {
        return res.status(403).json({ message: "Access denied" });
      }

      const comments = await ThreadComment.find({
        threadId: id,
        deletedAt: null,
      })
        .sort({ createdAt: 1 })
        .lean();

      const commentIds = comments.map((c) => c._id);
      const commentReactions = await ThreadReaction.find({
        targetType: "comment",
        targetId: { $in: commentIds },
      }).lean();

      const reactionsByComment: Record<
        string,
        Array<{ reaction: string; authorName: string; userId: string }>
      > = {};
      for (const r of commentReactions) {
        const key = r.targetId.toString();
        if (!reactionsByComment[key]) reactionsByComment[key] = [];
        reactionsByComment[key].push({
          reaction: r.reaction,
          authorName: r.authorName,
          userId: r.userId.toString(),
        });
      }

      const enrichedComments = comments.map((c) => {
        const cId = c._id.toString();
        const reactions = reactionsByComment[cId] || [];
        return {
          ...c,
          reactionSummary: buildReactionSummary(reactions),
          myReaction:
            reactions.find((r) => r.userId === req.user!.id.toString())
              ?.reaction ?? null,
        };
      });

      res.json({ comments: enrichedComments, total: enrichedComments.length });
    } catch (err) {
      console.error("Threads: get comments error:", err);
      res.status(500).json({ message: "Failed to fetch comments" });
    }
  }
);

// ─── POST /api/threads/:id/comments ──────────────────────────────────────────

router.post(
  "/:id/comments",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid post ID" });
      }

      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ message: "Comment cannot be empty" });
      }
      if (content.trim().length > 1000) {
        return res
          .status(400)
          .json({ message: "Comment cannot exceed 1000 characters" });
      }

      const post = await Thread.findOne({ _id: id, deletedAt: null }).lean();
      if (!post) return res.status(404).json({ message: "Post not found" });

      const brand = await checkBrandAccess(req.user!, post.brandId.toString());
      if (!brand) {
        return res.status(403).json({ message: "Access denied" });
      }

      const adminId =
        req.user!.role === "admin"
          ? req.user!.id
          : (brand.createdBy as mongoose.Types.ObjectId).toString();

      const comment = await ThreadComment.create({
        threadId: id,
        brandId: post.brandId,
        adminId,
        userId: req.user!.id,
        // ✅ FIX: fallback to email if name is missing
        authorName: req.user!.name || req.user!.email,
        authorEmail: req.user!.email,
        authorRole: req.user!.role,
        content: content.trim(),
      });

      res.status(201).json({
        message: "Comment added",
        comment: {
          ...comment.toObject(),
          reactionSummary: {},
          myReaction: null,
        },
      });
    } catch (err) {
      console.error("Threads: add comment error:", err);
      res.status(500).json({ message: "Failed to add comment" });
    }
  }
);

// ─── DELETE /api/threads/:postId/comments/:commentId ─────────────────────────

router.delete(
  "/:postId/comments/:commentId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { postId, commentId } = req.params;

      const comment = await ThreadComment.findOne({
        _id: commentId,
        threadId: postId,
        deletedAt: null,
      });
      if (!comment) {
        return res.status(404).json({ message: "Comment not found" });
      }

      const isOwner = comment.userId.toString() === req.user!.id.toString();
      const isAdmin = req.user!.role === "admin";
      if (!isOwner && !isAdmin) {
        return res
          .status(403)
          .json({ message: "You can only delete your own comments" });
      }

      comment.deletedAt = new Date();
      await comment.save();

      res.json({ message: "Comment deleted", commentId });
    } catch (err) {
      console.error("Threads: delete comment error:", err);
      res.status(500).json({ message: "Failed to delete comment" });
    }
  }
);

export default router;