import express from 'express';
import { authMiddleware } from '../middleware/auth';
import Thread from '../models/Thread';
import ThreadComment from '../models/ThreadComment';
import Brand from '../models/Brand';
import TeamMember from '../models/TeamMember';
import Project from '../models/Projects';

const router = express.Router();

// Helper: Check if user can access thread
const canAccessThread = async (userId: string, thread: any) => {
  // If thread has no projectId, check if user is brand team member
  if (!thread.projectId) {
    const brand = await Brand.findById(thread.brandId);
    if (!brand) return false;
    
    const isBrandMember = brand.teamMembers?.some((member: any) => 
      member.email === thread.createdByEmail || member._id === userId
    );
    
    return isBrandMember || thread.createdBy.toString() === userId;
  }
  
  // If thread has projectId, check if user is project team member
  const isTeamMember = await TeamMember.findOne({
    projectId: thread.projectId,
    userId: userId,
    status: 'active',
  });
  
  return !!isTeamMember || thread.createdBy.toString() === userId;
};

// CREATE thread
router.post('/brands/:brandId/threads', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { brandId } = req.params;
    const { title, content, projectId, attachments } = req.body;

    console.log('CREATE THREAD REQUEST:', {
      brandId,
      userId: req.user!.id,
      hasTitle: !!title,
      hasContent: !!content,
      projectId,
      attachmentsCount: attachments?.length || 0
    });

    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }

    // Verify brand exists
    const brand = await Brand.findById(brandId);
    if (!brand) {
      console.log('Brand not found:', brandId);
      return res.status(404).json({ message: 'Brand not found' });
    }

    console.log('Brand found:', brand.name);

    // If projectId specified, verify user is team member
    if (projectId) {
      const isTeamMember = await TeamMember.findOne({
        projectId,
        userId: req.user!.id,
        status: 'active',
      });

      if (!isTeamMember) {
        console.log('User not a team member of project:', projectId);
        return res.status(403).json({ message: 'You are not a member of this project' });
      }
      console.log('User is team member of project');
    }

    const newThread = await Thread.create({
      title,
      content,
      brandId,
      projectId: projectId || undefined,
      createdBy: req.user!.id,
      createdByName: req.user!.name,
      createdByEmail: req.user!.email,
      attachments: attachments || [],
    });

    console.log('Thread created successfully:', newThread._id);

    res.status(201).json({
      message: 'Thread created successfully',
      thread: newThread,
    });
  } catch (error) {
    console.error('Create thread error:', error);
    res.status(500).json({ 
      message: 'Failed to create thread',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET all threads for a brand (with filtering)
router.get('/brands/:brandId/threads', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { brandId } = req.params;
    const { projectId } = req.query;

    console.log('GET THREADS REQUEST:', { brandId, projectId, userId: req.user!.id });

    // Verify brand exists
    const brand = await Brand.findById(brandId);
    if (!brand) {
      console.log('Brand not found:', brandId);
      return res.status(404).json({ message: 'Brand not found' });
    }

    // Build query
    let query: any = { brandId };
    
    if (projectId && projectId !== 'all') {
      query.projectId = projectId;
    }

    // Get all threads
    let threads = await Thread.find(query)
      .sort({ isPinned: -1, createdAt: -1 })
      .lean();

    console.log(`Found ${threads.length} threads for brand`);

    // Filter threads based on user access
    const accessibleThreads = [];
    for (const thread of threads) {
      const hasAccess = await canAccessThread(req.user!.id, thread);
      if (hasAccess) {
        accessibleThreads.push(thread);
      }
    }

    console.log(`User has access to ${accessibleThreads.length} threads`);

    res.json(accessibleThreads);
  } catch (error) {
    console.error('Get threads error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch threads',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET single thread with comments
router.get('/threads/:threadId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { threadId } = req.params;

    const thread = await Thread.findById(threadId).lean();
    if (!thread) {
      return res.status(404).json({ message: 'Thread not found' });
    }

    // Check access
    const hasAccess = await canAccessThread(req.user!.id, thread);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get comments
    const comments = await ThreadComment.find({ threadId })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ thread, comments });
  } catch (error) {
    console.error('Get thread error:', error);
    res.status(500).json({ message: 'Failed to fetch thread' });
  }
});

// GET projects for brand (for dropdown)
router.get('/brands/:brandId/projects', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { brandId } = req.params;

    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res.status(404).json({ message: 'Brand not found' });
    }

    // Get projects where user is a team member
    const teamMemberships = await TeamMember.find({
      userId: req.user!.id,
      status: 'active',
    }).populate('projectId', 'projectName brand');

    const projects = teamMemberships
      .filter((tm: any) => tm.projectId && tm.projectId.brand === brand.name)
      .map((tm: any) => ({
        _id: tm.projectId._id,
        projectName: tm.projectId.projectName,
      }));

    res.json(projects);
  } catch (error) {
    console.error('Get brand projects error:', error);
    res.status(500).json({ message: 'Failed to fetch projects' });
  }
});

// UPDATE thread
router.put('/threads/:threadId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { threadId } = req.params;
    const { title, content, attachments } = req.body;

    const thread = await Thread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ message: 'Thread not found' });
    }

    // Check if user is the creator
    if (thread.createdBy.toString() !== req.user!.id) {
      return res.status(403).json({ message: 'You can only edit your own threads' });
    }

    thread.title = title || thread.title;
    thread.content = content || thread.content;
    if (attachments) {
      thread.attachments = attachments;
    }

    await thread.save();

    res.json({
      message: 'Thread updated successfully',
      thread,
    });
  } catch (error) {
    console.error('Update thread error:', error);
    res.status(500).json({ message: 'Failed to update thread' });
  }
});

// DELETE thread
router.delete('/threads/:threadId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { threadId } = req.params;

    const thread = await Thread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ message: 'Thread not found' });
    }

    // Check if user is the creator
    if (thread.createdBy.toString() !== req.user!.id) {
      return res.status(403).json({ message: 'You can only delete your own threads' });
    }

    // Delete all comments
    await ThreadComment.deleteMany({ threadId });

    // Delete thread
    await Thread.findByIdAndDelete(threadId);

    res.json({ message: 'Thread deleted successfully' });
  } catch (error) {
    console.error('Delete thread error:', error);
    res.status(500).json({ message: 'Failed to delete thread' });
  }
});

// LIKE/UNLIKE thread
router.post('/threads/:threadId/like', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { threadId } = req.params;

    const thread = await Thread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ message: 'Thread not found' });
    }

    const userIdObj = req.user!.id as any;
    const likeIndex = thread.likes.findIndex(id => id.toString() === userIdObj);

    if (likeIndex > -1) {
      // Unlike
      thread.likes.splice(likeIndex, 1);
    } else {
      // Like
      thread.likes.push(userIdObj);
    }

    await thread.save();

    res.json({
      message: likeIndex > -1 ? 'Thread unliked' : 'Thread liked',
      likes: thread.likes.length,
      isLiked: likeIndex === -1,
    });
  } catch (error) {
    console.error('Like thread error:', error);
    res.status(500).json({ message: 'Failed to like thread' });
  }
});

// CREATE comment
router.post('/threads/:threadId/comments', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { threadId } = req.params;
    const { content, attachments } = req.body;

    if (!content) {
      return res.status(400).json({ message: 'Content is required' });
    }

    const thread = await Thread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ message: 'Thread not found' });
    }

    // Check access
    const hasAccess = await canAccessThread(req.user!.id, thread);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const newComment = await ThreadComment.create({
      threadId,
      content,
      createdBy: req.user!.id,
      createdByName: req.user!.name,
      createdByEmail: req.user!.email,
      attachments: attachments || [],
    });

    // Update comment count
    thread.commentCount = (thread.commentCount || 0) + 1;
    await thread.save();

    res.status(201).json({
      message: 'Comment added successfully',
      comment: newComment,
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ message: 'Failed to add comment' });
  }
});

// UPDATE comment
router.put('/comments/:commentId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { commentId } = req.params;
    const { content, attachments } = req.body;

    const comment = await ThreadComment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check if user is the creator
    if (comment.createdBy.toString() !== req.user!.id) {
      return res.status(403).json({ message: 'You can only edit your own comments' });
    }

    comment.content = content || comment.content;
    if (attachments) {
      comment.attachments = attachments;
    }

    await comment.save();

    res.json({
      message: 'Comment updated successfully',
      comment,
    });
  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({ message: 'Failed to update comment' });
  }
});

// DELETE comment
router.delete('/comments/:commentId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { commentId } = req.params;

    const comment = await ThreadComment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check if user is the creator
    if (comment.createdBy.toString() !== req.user!.id) {
      return res.status(403).json({ message: 'You can only delete your own comments' });
    }

    // Update thread comment count
    await Thread.findByIdAndUpdate(comment.threadId, {
      $inc: { commentCount: -1 },
    });

    // Delete comment
    await ThreadComment.findByIdAndDelete(commentId);

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ message: 'Failed to delete comment' });
  }
});

// LIKE/UNLIKE comment
router.post('/comments/:commentId/like', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { commentId } = req.params;

    const comment = await ThreadComment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const userIdObj = req.user!.id as any;
    const likeIndex = comment.likes.findIndex(id => id.toString() === userIdObj);

    if (likeIndex > -1) {
      // Unlike
      comment.likes.splice(likeIndex, 1);
    } else {
      // Like
      comment.likes.push(userIdObj);
    }

    await comment.save();

    res.json({
      message: likeIndex > -1 ? 'Comment unliked' : 'Comment liked',
      likes: comment.likes.length,
      isLiked: likeIndex === -1,
    });
  } catch (error) {
    console.error('Like comment error:', error);
    res.status(500).json({ message: 'Failed to like comment' });
  }
});

export default router;