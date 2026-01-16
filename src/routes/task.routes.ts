import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Task from '../models/Task';
import Project from '../models/Projects';

const router = Router();

// GET all tasks for a project (Admin only)
router.get('/:projectId/tasks', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Verify project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const tasks = await Task.find({ projectId })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.json(tasks);
  } catch (error: any) {
    console.error('Get tasks error:', error);
    res.status(500).json({ message: 'Failed to fetch tasks', error: error.message });
  }
});

// GET single task (Admin only)
router.get('/:projectId/tasks/:taskId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId)
      .populate('createdBy', 'name email')
      .populate('projectId', 'projectName');

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json(task);
  } catch (error: any) {
    console.error('Get task error:', error);
    res.status(500).json({ message: 'Failed to fetch task', error: error.message });
  }
});

// GET task statistics for a project (Admin only)
router.get('/:projectId/tasks/stats/overview', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;

    const totalTasks = await Task.countDocuments({ projectId });
    const completedTasks = await Task.countDocuments({ projectId, status: 'Done' });
    const inProgressTasks = await Task.countDocuments({ projectId, status: 'In Progress' });
    const overdueTasks = await Task.countDocuments({ projectId, status: 'Blocked' });
    const backlogTasks = await Task.countDocuments({ projectId, status: 'Backlog' });

    res.json({
      totalTasks,
      completedTasks,
      inProgressTasks,
      overdueTasks,
      backlogTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    });
  } catch (error: any) {
    console.error('Get task stats error:', error);
    res.status(500).json({ message: 'Failed to fetch task statistics', error: error.message });
  }
});

// CREATE new task (Admin only)
router.post('/:projectId/tasks', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const {
      title,
      description,
      status,
      priority,
      assignees, // array of assignees to
      startDate,
      dueDate,
      progress,
      estimateHours
    } = req.body;

    // Validate required fields
    if (
      !title ||
      !assignees ||
      !Array.isArray(assignees) ||
      assignees.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Title and at least one assignee are required" });
    }

    // Validate each assignee has email and name
    const invalidAssignee = assignees.find((a: any) => !a.email || !a.name);
    if (invalidAssignee) {
      return res
        .status(400)
        .json({ message: "Each assignee must have email and name" });
    }

    // Verify project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const newTask = await Task.create({
      title,
      description,
      status: status || 'Backlog',
      priority: priority || 'Medium',
      assignees, // NEW: array
      startDate,
      dueDate,
      progress: progress || 0,
      estimateHours,
      projectId,
      createdBy: req.user.id,
    });

    const populatedTask = await Task.findById(newTask._id)
      .populate('createdBy', 'name email')
      .populate('projectId', 'projectName');

    res.status(201).json({
      message: 'Task created successfully',
      task: populatedTask,
    });
  } catch (error: any) {
    console.error('Create task error:', error);
    res.status(500).json({ message: 'Failed to create task', error: error.message });
  }
});

// UPDATE task (Admin only)
router.put('/:projectId/tasks/:taskId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    const updateData = req.body;

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'name email')
      .populate('projectId', 'projectName');

    if (!updatedTask) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json({
      message: 'Task updated successfully',
      task: updatedTask,
    });
  } catch (error: any) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Failed to update task', error: error.message });
  }
});

// DELETE task (Admin only)
router.delete('/:projectId/tasks/:taskId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;

    const deletedTask = await Task.findByIdAndDelete(taskId);

    if (!deletedTask) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (error: any) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Failed to delete task', error: error.message });
  }
});

export default router;