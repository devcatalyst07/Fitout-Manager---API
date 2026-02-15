import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { authMiddleware } from '../middleware/auth';
import { requireAdmin as adminOnly } from '../middleware/permissions';
import Scope from '../models/Scope';
import Workflow from '../models/Workflow';
import Phase from '../models/Phase';
import Task from '../models/Task';
import Brand from '../models/Brand';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  },
});

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

// ==================== BULK UPLOAD TASKS ====================

// Download Excel template
router.get(
  '/:scopeId/workflows/:workflowId/templates/task-upload-template.xlsx',
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const { scopeId, workflowId } = req.params;

      // Verify workflow exists
      const workflow = await Workflow.findOne({ _id: workflowId, scopeId });
      if (!workflow) {
        return res.status(404).json({ message: 'Workflow not found' });
      }

      // Create sample template data
      const templateData = [
        {
          'Task ID': 'T001',
          'Phase Name': 'Planning',
          'Task Title': 'Initial Site Survey',
          'Task Description': 'Conduct comprehensive site survey and document existing conditions',
          'Task Type': 'Task',
          'Priority': 'High',
          'Predecessor IDs': '',
          'Dependency Type': '',
          'Lag (Days)': '0',
          'Duration (Days)': '3',
        },
        {
          'Task ID': 'T002',
          'Phase Name': 'Planning',
          'Task Title': 'Design Review Meeting',
          'Task Description': 'Review design plans with stakeholders',
          'Task Type': 'Milestone',
          'Priority': 'Critical',
          'Predecessor IDs': 'T001',
          'Dependency Type': 'FS',
          'Lag (Days)': '0',
          'Duration (Days)': '1',
        },
        {
          'Task ID': 'T003',
          'Phase Name': 'Execution',
          'Task Title': 'Material Procurement',
          'Task Description': 'Order and receive construction materials',
          'Task Type': 'Task',
          'Priority': 'High',
          'Predecessor IDs': 'T002',
          'Dependency Type': 'FS',
          'Lag (Days)': '2',
          'Duration (Days)': '5',
        },
        {
          'Task ID': 'T004',
          'Phase Name': 'Execution',
          'Task Title': 'Construction Phase 1',
          'Task Description': 'Complete first phase of construction work',
          'Task Type': 'Task',
          'Priority': 'Medium',
          'Predecessor IDs': 'T003',
          'Dependency Type': 'FS',
          'Lag (Days)': '0',
          'Duration (Days)': '10',
        },
        {
          'Task ID': 'T005',
          'Phase Name': 'Execution',
          'Task Title': 'Final Deliverable',
          'Task Description': 'Prepare and submit final deliverable package',
          'Task Type': 'Deliverable',
          'Priority': 'Critical',
          'Predecessor IDs': 'T004',
          'Dependency Type': 'FS',
          'Lag (Days)': '1',
          'Duration (Days)': '2',
        },
      ];

      const worksheet = XLSX.utils.json_to_sheet(templateData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Tasks');

      // Set column widths for better readability
      worksheet['!cols'] = [
        { wch: 10 },  // Task ID
        { wch: 20 },  // Phase Name
        { wch: 30 },  // Task Title
        { wch: 50 },  // Task Description
        { wch: 15 },  // Task Type
        { wch: 12 },  // Priority
        { wch: 20 },  // Predecessor IDs
        { wch: 18 },  // Dependency Type
        { wch: 12 },  // Lag (Days)
        { wch: 15 },  // Duration (Days)
      ];

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=task-upload-template.xlsx'
      );
      res.send(buffer);
    } catch (error: any) {
      console.error('Template download error:', error);
      res.status(500).json({ message: 'Failed to generate template' });
    }
  }
);

// Bulk upload tasks from Excel
router.post(
  '/:scopeId/workflows/:workflowId/tasks/bulk-upload',
  authMiddleware,
  adminOnly,
  upload.single('file'),
  async (req: express.Request, res: express.Response) => {
    try {
      const { scopeId, workflowId } = req.params;

      // Verify workflow exists
      const workflow = await Workflow.findOne({ _id: workflowId, scopeId });
      if (!workflow) {
        return res.status(404).json({ message: 'Workflow not found' });
      }

      // Get uploaded file from multer
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      // Parse Excel file
      const workbook = XLSX.read(file.buffer);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as any[];

      if (rows.length === 0) {
        return res.status(400).json({ message: 'Excel file is empty' });
      }

      // Validate required columns
      const requiredColumns = [
        'Task ID',
        'Phase Name',
        'Task Title',
        'Task Type',
        'Duration (Days)',
      ];

      const firstRow: any = rows[0];
      const actualColumns = Object.keys(firstRow);

      const missingColumns = requiredColumns.filter(
        (col) => !actualColumns.includes(col)
      );

      if (missingColumns.length > 0) {
        return res.status(400).json({
          message: `Missing required columns: ${missingColumns.join(', ')}`,
        });
      }

      // Group tasks by phase
      const phaseMap = new Map<string, any[]>();
      rows.forEach((row: any) => {
        const phaseName = row['Phase Name'];
        if (!phaseMap.has(phaseName)) {
          phaseMap.set(phaseName, []);
        }
        phaseMap.get(phaseName)!.push(row);
      });

      let phasesCreated = 0;
      let tasksCreated = 0;
      const taskIdMap = new Map<string, string>(); // Excel Task ID -> MongoDB _id

      // First pass: Create phases and tasks (without dependencies)
      for (const [phaseName, phaseTasks] of phaseMap.entries()) {
        // Find or create phase
        let phase = await Phase.findOne({
          workflowId,
          scopeId,
          name: phaseName,
          isTemplate: true,
        });

        if (!phase) {
          const maxPhase = await Phase.findOne({
            workflowId,
            scopeId,
            isTemplate: true,
          }).sort({ order: -1 });

          phase = await Phase.create({
            name: phaseName,
            workflowId,
            scopeId,
            order: maxPhase ? maxPhase.order + 1 : 0,
            isTemplate: true,
            createdBy: req.user!.id,
          });
          phasesCreated++;
        }

        // Create tasks for this phase
        for (const taskRow of phaseTasks) {
          const duration = parseFloat(taskRow['Duration (Days)']) || 1;
          const taskType = taskRow['Task Type'] || 'Task';

          // Validate milestone duration
          if (taskType === 'Milestone' && duration > 1) {
            return res.status(400).json({
              message: `Task "${taskRow['Task Title']}" is a Milestone but has duration > 1 day`,
            });
          }

          const newTask = await Task.create({
            title: taskRow['Task Title'],
            description: taskRow['Task Description'] || '',
            priority: taskRow['Priority'] || 'Medium',
            taskType: taskType,
            duration: duration,
            dependencies: [], // Will be populated in second pass
            phaseId: phase._id,
            workflowId,
            scopeId,
            isTemplate: true,
            assignees: [],
            order: tasksCreated,
            createdBy: req.user!.id,
          });

          // Map Excel Task ID to MongoDB _id
          taskIdMap.set(taskRow['Task ID'], newTask._id.toString());
          tasksCreated++;
        }
      }

      // Second pass: Add dependencies
      for (const row of rows) {
        const mongoTaskId = taskIdMap.get(row['Task ID']);
        if (!mongoTaskId) continue;

        const predecessorIds = row['Predecessor IDs']
          ? row['Predecessor IDs']
              .split(';')
              .map((id: string) => id.trim())
              .filter(Boolean)
          : [];

        const dependencyTypes = row['Dependency Type']
          ? row['Dependency Type']
              .split(';')
              .map((t: string) => t.trim())
              .filter(Boolean)
          : [];

        if (predecessorIds.length > 0) {
          const dependencies = predecessorIds
            .map((predId: string, index: number) => {
              const mongoPredId = taskIdMap.get(predId);
              if (!mongoPredId) {
                console.warn(
                  `Warning: Predecessor ID "${predId}" not found for task "${row['Task Title']}"`
                );
                return null;
              }

              const depType = dependencyTypes[index] || 'FS';
              if (!['FS', 'SS'].includes(depType)) {
                console.warn(
                  `Warning: Invalid dependency type "${depType}" for task "${row['Task Title']}", defaulting to FS`
                );
                return {
                  taskId: mongoPredId,
                  type: 'FS' as const,
                };
              }

              return {
                taskId: mongoPredId,
                type: depType as 'FS' | 'SS',
              };
            })
            .filter(Boolean);

          if (dependencies.length > 0) {
            await Task.findByIdAndUpdate(mongoTaskId, {
              $set: { dependencies },
            });
          }
        }
      }

      res.json({
        success: true,
        phasesCreated,
        tasksCreated,
        message: `Successfully uploaded ${tasksCreated} tasks across ${phasesCreated} new phases`,
      });
    } catch (error: any) {
      console.error('Bulk upload error:', error);
      res.status(500).json({
        message: error.message || 'Failed to upload tasks',
      });
    }
  }
);

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