import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Scope from '../models/Scope';
import Brand from '../models/Brand';
import mongoose from 'mongoose';
import { IPhase, IPredefinedTask } from '../models/Scope';

const router = Router();

// ==================== GET ALL SCOPES ====================
// GET /api/scopes?brandFilter=all|specific&brandId=xxx
router.get('/', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
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

// ==================== GET SINGLE SCOPE ====================
router.get('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const scope = await Scope.findById(id)
      .populate('createdBy', 'name email')
      .populate('brandId', 'name');

    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    res.json(scope);
  } catch (error) {
    console.error('Get scope error:', error);
    res.status(500).json({ message: 'Failed to fetch scope' });
  }
});

// ==================== GET SCOPES FOR PROJECT CREATION ====================
// This is used when creating a project - filters by brand
router.get('/for-brand/:brandName', authMiddleware, async (req, res) => {
  try {
    const { brandName } = req.params;

    // Find scopes that apply to this brand (either 'all' or specific to this brand)
    const scopes = await Scope.find({
      isActive: true,
      $or: [
        { brandFilter: 'all' },
        { brandFilter: 'specific', brandName: brandName },
      ],
    }).sort({ name: 1 });

    res.json(scopes);
  } catch (error) {
    console.error('Get scopes for brand error:', error);
    res.status(500).json({ message: 'Failed to fetch scopes' });
  }
});

// ==================== CREATE SCOPE ====================
router.post('/', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { name, description, brandFilter, brandId } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Scope name is required' });
    }

    if (!brandFilter || !['all', 'specific'].includes(brandFilter)) {
      return res.status(400).json({ message: 'Valid brand filter is required' });
    }

    // Validate brand if specific
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

    // Check for duplicate scope name (same brand context)
    const existingScope = await Scope.findOne({
      name,
      brandFilter,
      ...(brandFilter === 'specific' ? { brandId } : {}),
    });

    if (existingScope) {
      return res.status(400).json({ 
        message: brandFilter === 'all' 
          ? 'A scope with this name already exists for all brands'
          : 'A scope with this name already exists for this brand'
      });
    }

    const newScope = await Scope.create({
      name,
      description,
      brandFilter,
      brandId: brandFilter === 'specific' ? brandId : undefined,
      brandName,
      workflows: [],
      createdBy: req.user.id,
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

// ==================== UPDATE SCOPE ====================
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, brandFilter, brandId, isActive } = req.body;

    const scope = await Scope.findById(id);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    // Validate brand if changing to specific
    let brandName = scope.brandName;
    if (brandFilter === 'specific' && brandId) {
      const brand = await Brand.findById(brandId);
      if (!brand) {
        return res.status(404).json({ message: 'Brand not found' });
      }
      brandName = brand.name;
    }

    // Check for duplicate name
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

// ==================== DELETE SCOPE ====================
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const deletedScope = await Scope.findByIdAndDelete(id);

    if (!deletedScope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    res.json({ message: 'Scope deleted successfully' });
  } catch (error) {
    console.error('Delete scope error:', error);
    res.status(500).json({ message: 'Failed to delete scope' });
  }
});

// ==================== ADD WORKFLOW TO SCOPE ====================
router.post('/:id/workflows', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Workflow name is required' });
    }

    const scope = await Scope.findById(id);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    // Check for duplicate workflow name in this scope
    const existingWorkflow = scope.workflows.find(w => w.name === name);
    if (existingWorkflow) {
      return res.status(400).json({ message: 'Workflow name already exists in this scope' });
    }

    const newWorkflow = {
      _id: new mongoose.Types.ObjectId().toString(),
      name,
      description,
      phases: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    scope.workflows.push(newWorkflow);
    await scope.save();

    res.status(201).json({
      message: 'Workflow added successfully',
      workflow: newWorkflow,
    });
  } catch (error) {
    console.error('Add workflow error:', error);
    res.status(500).json({ message: 'Failed to add workflow' });
  }
});

// ==================== UPDATE WORKFLOW ====================
router.put('/:scopeId/workflows/:workflowId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId } = req.params;
    const { name, description } = req.body;

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check for duplicate name
    if (name && name !== workflow.name) {
      const duplicate = scope.workflows.find(
        w => w._id.toString() !== workflowId && w.name === name
      );
      if (duplicate) {
        return res.status(400).json({ message: 'Workflow name already exists' });
      }
    }

    workflow.name = name || workflow.name;
    workflow.description = description !== undefined ? description : workflow.description;
    workflow.updatedAt = new Date();

    await scope.save();

    res.json({
      message: 'Workflow updated successfully',
      workflow,
    });
  } catch (error) {
    console.error('Update workflow error:', error);
    res.status(500).json({ message: 'Failed to update workflow' });
  }
});

// ==================== DELETE WORKFLOW ====================
router.delete('/:scopeId/workflows/:workflowId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId } = req.params;

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflowIndex = scope.workflows.findIndex(
      w => w._id.toString() === workflowId
    );

    if (workflowIndex === -1) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    scope.workflows.splice(workflowIndex, 1);
    await scope.save();

    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ message: 'Failed to delete workflow' });
  }
});

// ==================== ADD PHASE TO WORKFLOW ====================
router.post('/:scopeId/workflows/:workflowId/phases', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId } = req.params;
    const { name, order } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Phase name is required' });
    }

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const newPhase = {
      _id: new mongoose.Types.ObjectId().toString(),
      name,
      order: order || workflow.phases.length,
      tasks: [],
    };

    workflow.phases.push(newPhase);
    workflow.updatedAt = new Date();
    await scope.save();

    res.status(201).json({
      message: 'Phase added successfully',
      phase: newPhase,
    });
  } catch (error) {
    console.error('Add phase error:', error);
    res.status(500).json({ message: 'Failed to add phase' });
  }
});

// ==================== UPDATE PHASE ====================
router.put('/:scopeId/workflows/:workflowId/phases/:phaseId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId, phaseId } = req.params;
    const { name, order } = req.body;

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const phase = workflow.phases.find((p: IPhase) => p._id.toString() === phaseId);
    if (!phase) {
      return res.status(404).json({ message: 'Phase not found' });
    }

    phase.name = name || phase.name;
    if (order !== undefined) phase.order = order;

    workflow.updatedAt = new Date();
    await scope.save();

    res.json({
      message: 'Phase updated successfully',
      phase,
    });
  } catch (error) {
    console.error('Update phase error:', error);
    res.status(500).json({ message: 'Failed to update phase' });
  }
});

// ==================== DELETE PHASE ====================
router.delete('/:scopeId/workflows/:workflowId/phases/:phaseId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId, phaseId } = req.params;

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const phaseIndex = workflow.phases.findIndex(
      (p: IPhase) => p._id.toString() === phaseId
    );

    if (phaseIndex === -1) {
      return res.status(404).json({ message: 'Phase not found' });
    }

    workflow.phases.splice(phaseIndex, 1);
    workflow.updatedAt = new Date();
    await scope.save();

    res.json({ message: 'Phase deleted successfully' });
  } catch (error) {
    console.error('Delete phase error:', error);
    res.status(500).json({ message: 'Failed to delete phase' });
  }
});

// ==================== ADD PREDEFINED TASK ====================
router.post('/:scopeId/workflows/:workflowId/phases/:phaseId/tasks', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId, phaseId } = req.params;
    const { title, description, priority, estimateHours, order } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'Task title is required' });
    }

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const phase = workflow.phases.find((p: IPhase) => p._id.toString() === phaseId);
    if (!phase) {
      return res.status(404).json({ message: 'Phase not found' });
    }

    const newTask = {
      _id: new mongoose.Types.ObjectId().toString(),
      title,
      description,
      priority: priority || 'Medium',
      estimateHours,
      order: order !== undefined ? order : phase.tasks.length,
    };

    phase.tasks.push(newTask);
    workflow.updatedAt = new Date();
    await scope.save();

    res.status(201).json({
      message: 'Task added successfully',
      task: newTask,
    });
  } catch (error) {
    console.error('Add task error:', error);
    res.status(500).json({ message: 'Failed to add task' });
  }
});

// ==================== UPDATE PREDEFINED TASK ====================
router.put('/:scopeId/workflows/:workflowId/phases/:phaseId/tasks/:taskId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId, phaseId, taskId } = req.params;
    const { title, description, priority, estimateHours, order } = req.body;

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const phase = workflow.phases.find((p: IPhase) => p._id.toString() === phaseId);
    if (!phase) {
      return res.status(404).json({ message: 'Phase not found' });
    }

    const task = phase.tasks.find((t: IPredefinedTask) => t._id.toString() === taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    task.title = title || task.title;
    if (description !== undefined) task.description = description;
    if (priority) task.priority = priority;
    if (estimateHours !== undefined) task.estimateHours = estimateHours;
    if (order !== undefined) task.order = order;

    workflow.updatedAt = new Date();
    await scope.save();

    res.json({
      message: 'Task updated successfully',
      task,
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Failed to update task' });
  }
});

// ==================== DELETE PREDEFINED TASK ====================
router.delete('/:scopeId/workflows/:workflowId/phases/:phaseId/tasks/:taskId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId, phaseId, taskId } = req.params;

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const phase = workflow.phases.find((p: IPhase) => p._id.toString() === phaseId);
    if (!phase) {
      return res.status(404).json({ message: 'Phase not found' });
    }

    const taskIndex = phase.tasks.findIndex(
      (t: IPredefinedTask) => t._id.toString() === taskId
    );

    if (taskIndex === -1) {
      return res.status(404).json({ message: 'Task not found' });
    }

    phase.tasks.splice(taskIndex, 1);
    workflow.updatedAt = new Date();
    await scope.save();

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Failed to delete task' });
  }
});

// ==================== IMPORT TASKS FROM EXCEL ====================
router.post('/:scopeId/workflows/:workflowId/import-excel', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId } = req.params;
    const { phases } = req.body; // Array of phases with tasks

    if (!phases || !Array.isArray(phases)) {
      return res.status(400).json({ message: 'Invalid import data' });
    }

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Clear existing phases and add imported ones
    workflow.phases = phases.map((phase: any, phaseIndex: number) => ({
      _id: new mongoose.Types.ObjectId().toString(),
      name: phase.name,
      order: phaseIndex,
      tasks: phase.tasks.map((task: any, taskIndex: number) => ({
        _id: new mongoose.Types.ObjectId().toString(),
        title: task.title,
        description: task.description || '',
        priority: task.priority || 'Medium',
        estimateHours: task.estimateHours || 0,
        order: taskIndex,
      })),
    }));

    workflow.updatedAt = new Date();
    await scope.save();

    res.json({
      message: 'Tasks imported successfully',
      workflow,
    });
  } catch (error) {
    console.error('Import Excel error:', error);
    res.status(500).json({ message: 'Failed to import tasks' });
  }
});

// ==================== EXPORT TASKS TO EXCEL FORMAT ====================
router.get('/:scopeId/workflows/:workflowId/export', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { scopeId, workflowId } = req.params;

    const scope = await Scope.findById(scopeId);
    if (!scope) {
      return res.status(404).json({ message: 'Scope not found' });
    }

    const workflow = scope.workflows.find(w => w._id.toString() === workflowId);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Return structured data for Excel export
    const exportData = workflow.phases.map((phase: IPhase) => ({
      phaseName: phase.name,
      tasks: phase.tasks.map((task: IPredefinedTask) => ({
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        estimateHours: task.estimateHours || 0,
      })),
    }));

    res.json({
      scopeName: scope.name,
      workflowName: workflow.name,
      phases: exportData,
    });
  } catch (error) {
    console.error('Export workflow error:', error);
    res.status(500).json({ message: 'Failed to export workflow' });
  }
});

export default router;