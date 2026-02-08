import express from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireAdmin as adminOnly } from '../middleware/permissions';
import Scope from '../models/Scope';
import Workflow from '../models/Workflow';
import Phase from '../models/Phase';
import Task from '../models/Task';
import Brand from '../models/Brand';

const router = express.Router();

// ==================== SCOPE ROUTES ====================

// GET all scopes (with optional filtering)
router.get('/', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { brandFilter, brandId } = req.query;

    let query: any = { isActive: true };

    if (brandFilter === 'all') {
      query.brandFilter = 'all';
    } else if (brandFilter === 'specific' && brandId) {
      query.brandFilter = 'specific';
      query.brandId = brandId;
    }

    const scopes = await Scope.find(query)
      .populate('createdBy', 'name email')
      .populate('brandId', 'name')
      .sort({ createdAt: -1 });

    res.json(scopes);
  } catch (error) {
    console.error('Get scopes error:', error);
    res.status(500).json({ message: 'Failed to fetch scopes' });
  }
});

// GET single scope with workflows
router.get('/:id', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;

    const scope = await Scope.findById(id)
      .populate('createdBy', 'name email')
      .populate('brandId', 'name');

    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    // Get all workflows for this scope
    const workflows = await Workflow.find({ scopeId: id, isActive: true })
      .sort({ createdAt: -1 });

    res.json({
      ...scope.toObject(),
      workflows,
    });
  } catch (error) {
    console.error('Get scope error:', error);
    res.status(500).json({ message: 'Failed to fetch scope' });
  }
});

// GET scopes for project creation (filtered by brand)
router.get('/for-brand/:brandName', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { brandName } = req.params;

    const scopes = await Scope.find({
      isActive: true,
      $or: [
        { brandFilter: 'all' },
        { brandFilter: 'specific', brandName: brandName },
      ],
    }).sort({ name: 1 });

    // For each scope, get its workflows
    const scopesWithWorkflows = await Promise.all(
      scopes.map(async (scope) => {
        const workflows = await Workflow.find({
          scopeId: scope._id,
          isActive: true,
        }).sort({ name: 1 });

        return {
          ...scope.toObject(),
          workflows,
        };
      })
    );

    res.json(scopesWithWorkflows);
  } catch (error) {
    console.error('Get scopes for brand error:', error);
    res.status(500).json({ message: 'Failed to fetch scopes' });
  }
});

// CREATE scope
router.post('/', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { name, description, brandFilter, brandId } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Scope name is required' });
    }

    if (!brandFilter || !['all', 'specific'].includes(brandFilter)) {
      return res.status(400).json({ message: 'Valid brand filter is required' });
    }

    let brandName = undefined;
    if (brandFilter === 'specific') {
      if (!brandId) {
        return res.status(400).json({ message: 'Brand ID is required for specific brand filter' });
      }

      const brand = await Brand.findById(brandId);
      if (!brand) {
        return res.status(404).json({ message: 'Brand not found' });
      }
      brandName = brand.name;
    }

    // Check for duplicate scope name in same context
    const existingScope = await Scope.findOne({
      name,
      brandFilter,
      ...(brandFilter === 'specific' ? { brandId } : {}),
    });

    if (existingScope) {
      return res.status(400).json({
        message: brandFilter === 'all'
          ? 'A scope with this name already exists for all brands'
          : 'A scope with this name already exists for this brand',
      });
    }

    const newScope = await Scope.create({
      name,
      description,
      brandFilter,
      brandId: brandFilter === 'specific' ? brandId : undefined,
      brandName,
      createdBy: req.user!.id,
    });

    const populatedScope = await Scope.findById(newScope._id)
      .populate('createdBy', 'name email')
      .populate('brandId', 'name');

    res.status(201).json({
      message: 'Scope created successfully',
      scope: populatedScope,
    });
  } catch (error) {
    console.error('Create scope error:', error);
    res.status(500).json({ message: 'Failed to create scope' });
  }
});

// UPDATE scope
router.put('/:id', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    const { name, description, brandFilter, brandId, isActive } = req.body;

    const scope = await Scope.findById(id);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    let brandName = scope.brandName;
    if (brandFilter === 'specific' && brandId) {
      const brand = await Brand.findById(brandId);
      if (!brand) {
        return res.status(404).json({ message: 'Brand not found' });
      }
      brandName = brand.name;
    }

    if (name && name !== scope.name) {
      const existingScope = await Scope.findOne({
        _id: { $ne: id },
        name,
        brandFilter: brandFilter || scope.brandFilter,
        ...(brandFilter === 'specific' || scope.brandFilter === 'specific'
          ? { brandId: brandId || scope.brandId }
          : {}),
      });

      if (existingScope) {
        return res.status(400).json({ message: 'Scope name already exists' });
      }
    }

    const updatedScope = await Scope.findByIdAndUpdate(
      id,
      {
        name: name || scope.name,
        description,
        brandFilter: brandFilter || scope.brandFilter,
        brandId: brandFilter === 'specific' ? brandId : undefined,
        brandName,
        isActive,
      },
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'name email')
      .populate('brandId', 'name');

    res.json({
      message: 'Scope updated successfully',
      scope: updatedScope,
    });
  } catch (error) {
    console.error('Update scope error:', error);
    res.status(500).json({ message: 'Failed to update scope' });
  }
});

// DELETE scope (also deletes all workflows, phases, and tasks)
router.delete('/:id', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;

    const scope = await Scope.findById(id);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    // Delete all workflows for this scope
    const workflows = await Workflow.find({ scopeId: id });
    const workflowIds = workflows.map(w => w._id);

    // Delete all phases for these workflows
    await Phase.deleteMany({ workflowId: { $in: workflowIds } });

    // Delete all template tasks for these workflows
    await Task.deleteMany({ workflowId: { $in: workflowIds }, isTemplate: true });

    // Delete all workflows
    await Workflow.deleteMany({ scopeId: id });

    // Delete the scope
    await Scope.findByIdAndDelete(id);

    res.json({ message: 'Scope and all related data deleted successfully' });
  } catch (error) {
    console.error('Delete scope error:', error);
    res.status(500).json({ message: 'Failed to delete scope' });
  }
});

// ==================== WORKFLOW ROUTES ====================

// GET workflows for a scope
router.get('/:scopeId/workflows', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId } = req.params;

    const workflows = await Workflow.find({ scopeId, isActive: true })
      .sort({ createdAt: -1 });

    res.json(workflows);
  } catch (error) {
    console.error('Get workflows error:', error);
    res.status(500).json({ message: 'Failed to fetch workflows' });
  }
});

// GET single workflow with phases and tasks
router.get('/:scopeId/workflows/:workflowId', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId } = req.params;

    const workflow = await Workflow.findOne({ _id: workflowId, scopeId });
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Get all phases for this workflow
    const phases = await Phase.find({
      workflowId,
      scopeId,
      isTemplate: true,
    }).sort({ order: 1 });

    // Get all tasks for each phase
    const phasesWithTasks = await Promise.all(
      phases.map(async (phase) => {
        const tasks = await Task.find({
          phaseId: phase._id,
          workflowId,
          scopeId,
          isTemplate: true,
        }).sort({ order: 1 });

        return {
          ...phase.toObject(),
          tasks,
        };
      })
    );

    res.json({
      ...workflow.toObject(),
      phases: phasesWithTasks,
    });
  } catch (error) {
    console.error('Get workflow error:', error);
    res.status(500).json({ message: 'Failed to fetch workflow' });
  }
});

// CREATE workflow
router.post('/:scopeId/workflows', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId } = req.params;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Workflow name is required' });
    }

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    // Check for duplicate workflow name in this scope
    const existingWorkflow = await Workflow.findOne({ scopeId, name });
    if (existingWorkflow) {
      return res.status(400).json({ message: 'Workflow name already exists in this scope' });
    }

    const newWorkflow = await Workflow.create({
      name,
      description,
      scopeId,
      createdBy: req.user!.id,
    });

    res.status(201).json({
      message: 'Workflow created successfully',
      workflow: newWorkflow,
    });
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ message: 'Failed to create workflow' });
  }
});

// UPDATE workflow
router.put('/:scopeId/workflows/:workflowId', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId } = req.params;
    const { name, description, isActive } = req.body;

    const workflow = await Workflow.findOne({ _id: workflowId, scopeId });
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (name && name !== workflow.name) {
      const duplicate = await Workflow.findOne({
        _id: { $ne: workflowId },
        scopeId,
        name,
      });
      if (duplicate) {
        return res.status(400).json({ message: 'Workflow name already exists' });
      }
    }

    const updatedWorkflow = await Workflow.findByIdAndUpdate(
      workflowId,
      { name, description, isActive },
      { new: true, runValidators: true }
    );

    res.json({
      message: 'Workflow updated successfully',
      workflow: updatedWorkflow,
    });
  } catch (error) {
    console.error('Update workflow error:', error);
    res.status(500).json({ message: 'Failed to update workflow' });
  }
});

// DELETE workflow (also deletes all phases and tasks)
router.delete('/:scopeId/workflows/:workflowId', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId } = req.params;

    const workflow = await Workflow.findOne({ _id: workflowId, scopeId });
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Delete all phases for this workflow
    await Phase.deleteMany({ workflowId });

    // Delete all template tasks for this workflow
    await Task.deleteMany({ workflowId, isTemplate: true });

    // Delete the workflow
    await Workflow.findByIdAndDelete(workflowId);

    res.json({ message: 'Workflow and all related data deleted successfully' });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ message: 'Failed to delete workflow' });
  }
});

// ==================== PHASE ROUTES ====================

// GET phases for a workflow
router.get('/:scopeId/workflows/:workflowId/phases', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId } = req.params;

    const phases = await Phase.find({
      workflowId,
      scopeId,
      isTemplate: true,
    }).sort({ order: 1 });

    res.json(phases);
  } catch (error) {
    console.error('Get phases error:', error);
    res.status(500).json({ message: 'Failed to fetch phases' });
  }
});

// CREATE phase
router.post('/:scopeId/workflows/:workflowId/phases', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId } = req.params;
    const { name, description, order, color } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Phase name is required' });
    }

    const workflow = await Workflow.findOne({ _id: workflowId, scopeId });
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Get current max order if order not provided
    let phaseOrder = order;
    if (phaseOrder === undefined) {
      const maxPhase = await Phase.findOne({ workflowId, isTemplate: true })
        .sort({ order: -1 });
      phaseOrder = maxPhase ? maxPhase.order + 1 : 0;
    }

    const newPhase = await Phase.create({
      name,
      description,
      workflowId,
      scopeId,
      order: phaseOrder,
      color,
      isTemplate: true,
      createdBy: req.user!.id,
    });

    res.status(201).json({
      message: 'Phase created successfully',
      phase: newPhase,
    });
  } catch (error) {
    console.error('Create phase error:', error);
    res.status(500).json({ message: 'Failed to create phase' });
  }
});

// UPDATE phase
router.put('/:scopeId/workflows/:workflowId/phases/:phaseId', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId, phaseId } = req.params;
    const { name, description, order, color } = req.body;

    const phase = await Phase.findOne({
      _id: phaseId,
      workflowId,
      scopeId,
      isTemplate: true,
    });

    if (!phase) {
      return res.status(404).json({ message: 'Phase not found' });
    }

    const updatedPhase = await Phase.findByIdAndUpdate(
      phaseId,
      { name, description, order, color },
      { new: true, runValidators: true }
    );

    res.json({
      message: 'Phase updated successfully',
      phase: updatedPhase,
    });
  } catch (error) {
    console.error('Update phase error:', error);
    res.status(500).json({ message: 'Failed to update phase' });
  }
});

// DELETE phase (also deletes all tasks in this phase)
router.delete('/:scopeId/workflows/:workflowId/phases/:phaseId', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId, phaseId } = req.params;

    const phase = await Phase.findOne({
      _id: phaseId,
      workflowId,
      scopeId,
      isTemplate: true,
    });

    if (!phase) {
      return res.status(404).json({ message: 'Phase not found' });
    }

    // Delete all tasks in this phase
    await Task.deleteMany({ phaseId, isTemplate: true });

    // Delete the phase
    await Phase.findByIdAndDelete(phaseId);

    res.json({ message: 'Phase and all tasks deleted successfully' });
  } catch (error) {
    console.error('Delete phase error:', error);
    res.status(500).json({ message: 'Failed to delete phase' });
  }
});

// ==================== TASK ROUTES ====================

// GET tasks for a phase
router.get('/:scopeId/workflows/:workflowId/phases/:phaseId/tasks', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId, phaseId } = req.params;

    const tasks = await Task.find({
      phaseId,
      workflowId,
      scopeId,
      isTemplate: true,
    }).sort({ order: 1 });

    res.json(tasks);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
});

// CREATE task
router.post('/:scopeId/workflows/:workflowId/phases/:phaseId/tasks', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId, phaseId } = req.params;
    const { title, description, priority, estimateHours, order } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'Task title is required' });
    }

    const phase = await Phase.findOne({
      _id: phaseId,
      workflowId,
      scopeId,
      isTemplate: true,
    });

    if (!phase) {
      return res.status(404).json({ message: 'Phase not found' });
    }

    // Get current max order if order not provided
    let taskOrder = order;
    if (taskOrder === undefined) {
      const maxTask = await Task.findOne({ phaseId, isTemplate: true })
        .sort({ order: -1 });
      taskOrder = maxTask ? maxTask.order + 1 : 0;
    }

    const newTask = await Task.create({
      title,
      description,
      priority: priority || 'Medium',
      estimateHours,
      phaseId,
      workflowId,
      scopeId,
      order: taskOrder,
      isTemplate: true,
      assignees: [], // Templates don't have assignees
      createdBy: req.user!.id,
    });

    res.status(201).json({
      message: 'Task created successfully',
      task: newTask,
    });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ message: 'Failed to create task' });
  }
});

// UPDATE task
router.put('/:scopeId/workflows/:workflowId/phases/:phaseId/tasks/:taskId', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId, phaseId, taskId } = req.params;
    const { title, description, priority, estimateHours, order } = req.body;

    const task = await Task.findOne({
      _id: taskId,
      phaseId,
      workflowId,
      scopeId,
      isTemplate: true,
    });

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      { title, description, priority, estimateHours, order },
      { new: true, runValidators: true }
    );

    res.json({
      message: 'Task updated successfully',
      task: updatedTask,
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Failed to update task' });
  }
});

// DELETE task
router.delete('/:scopeId/workflows/:workflowId/phases/:phaseId/tasks/:taskId', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId, phaseId, taskId } = req.params;

    const task = await Task.findOne({
      _id: taskId,
      phaseId,
      workflowId,
      scopeId,
      isTemplate: true,
    });

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    await Task.findByIdAndDelete(taskId);

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Failed to delete task' });
  }
});

// ==================== BULK IMPORT/EXPORT ====================

// Export workflow structure
router.get('/:scopeId/workflows/:workflowId/export', authMiddleware, adminOnly, async (req: express.Request, res: express.Response) => {
  try {
    const { scopeId, workflowId } = req.params;

    const workflow = await Workflow.findOne({ _id: workflowId, scopeId });
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const scope = await Scope.findById(scopeId);

    const phases = await Phase.find({
      workflowId,
      scopeId,
      isTemplate: true,
    }).sort({ order: 1 });

    const exportData = await Promise.all(
      phases.map(async (phase) => {
        const tasks = await Task.find({
          phaseId: phase._id,
          workflowId,
          scopeId,
          isTemplate: true,
        }).sort({ order: 1 });

        return {
          phaseName: phase.name,
          phaseDescription: phase.description || '',
          tasks: tasks.map(task => ({
            title: task.title,
            description: task.description || '',
            priority: task.priority,
            estimateHours: task.estimateHours || 0,
          })),
        };
      })
    );

    res.json({
      scopeName: scope?.name,
      workflowName: workflow.name,
      phases: exportData,
    });
  } catch (error) {
    console.error('Export workflow error:', error);
    res.status(500).json({ message: 'Failed to export workflow' });
  }
});

export default router;