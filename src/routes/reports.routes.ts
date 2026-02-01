import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Project from '../models/Projects';
import Task from '../models/Task';
import BudgetItem from '../models/BudgetItem';
import Brand from '../models/Brand';

const router = Router();

// GET all projects for reports listing
router.get('/reports/projects', authMiddleware, adminOnly, async (req, res) => {
  try {
    const projects = await Project.find()
      .select('projectName projectCode brand')
      .sort({ createdAt: -1 });

    res.json(projects);
  } catch (error) {
    console.error('Get projects for reports error:', error);
    res.status(500).json({ message: 'Failed to fetch projects' });
  }
});

// GET all brands for reports
router.get('/reports/brands', authMiddleware, adminOnly, async (req, res) => {
  try {
    const brands = await Brand.find({ isActive: true }).select('name');
    res.json(brands);
  } catch (error) {
    console.error('Get brands for reports error:', error);
    res.status(500).json({ message: 'Failed to fetch brands' });
  }
});

// GENERATE Portfolio CSV Report
router.get('/reports/portfolio/csv', authMiddleware, adminOnly, async (req, res) => {
  try {
    const projects = await Project.find().populate('userId', 'name email');
    const allTasks = await Task.find();
    const allBudgetItems = await BudgetItem.find();

    // Build CSV data
    const csvRows: string[][] = [];

    // Header
    csvRows.push([
      'Report Type: Portfolio Overview',
      '',
      '',
      '',
      '',
      `Generated: ${new Date().toLocaleString()}`,
    ]);
    csvRows.push([]); // Empty row

    // Portfolio Summary
    csvRows.push(['PORTFOLIO SUMMARY']);
    csvRows.push(['Total Projects', projects.length.toString()]);
    csvRows.push(['Total Budget', projects.reduce((sum, p) => sum + (p.budget || 0), 0).toString()]);
    csvRows.push(['Total Spent', projects.reduce((sum, p) => sum + (p.spent || 0), 0).toString()]);
    csvRows.push(['Total Tasks', allTasks.length.toString()]);
    csvRows.push(['Completed Tasks', allTasks.filter(t => t.status === 'Done').length.toString()]);
    csvRows.push([]); // Empty row

    // Projects Details
    csvRows.push(['PROJECT DETAILS']);
    csvRows.push([
      'Project Name',
      'Brand',
      'Status',
      'Budget',
      'Spent',
      'Total Tasks',
      'Completed Tasks',
      'In Progress Tasks',
      'Total Budget Items',
      'Start Date',
      'End Date',
    ]);

    for (const project of projects) {
      const projectTasks = allTasks.filter(t => t.projectId && t.projectId.toString() === project._id.toString());
      const projectBudgetItems = allBudgetItems.filter(b => b.projectId.toString() === project._id.toString());

      csvRows.push([
        project.projectName,
        project.brand,
        project.status,
        project.budget.toString(),
        project.spent.toString(),
        projectTasks.length.toString(),
        projectTasks.filter(t => t.status === 'Done').length.toString(),
        projectTasks.filter(t => t.status === 'In Progress').length.toString(),
        projectBudgetItems.length.toString(),
        project.startDate ? new Date(project.startDate).toLocaleDateString() : 'N/A',
        project.endDate ? new Date(project.endDate).toLocaleDateString() : 'N/A',
      ]);
    }

    csvRows.push([]); // Empty row

    // Budget Items Summary
    csvRows.push(['BUDGET ITEMS SUMMARY']);
    csvRows.push(['Category', 'Total Items', 'Total Amount']);

    const categories = ['Design', 'Approvals', 'Construction', 'Joinery', 'MEP', 'Fixtures', 'Contingency', 'Misc'];
    for (const category of categories) {
      const categoryItems = allBudgetItems.filter(b => b.category === category);
      const totalAmount = categoryItems.reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);
      csvRows.push([category, categoryItems.length.toString(), totalAmount.toString()]);
    }

    // Convert to CSV string
    const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=portfolio-report-${Date.now()}.csv`);
    res.send(csvContent);
  } catch (error) {
    console.error('Generate portfolio CSV error:', error);
    res.status(500).json({ message: 'Failed to generate portfolio CSV' });
  }
});

// GENERATE Portfolio PDF Report Data
router.get('/reports/portfolio/pdf-data', authMiddleware, adminOnly, async (req, res) => {
  try {
    const projects = await Project.find().populate('userId', 'name email');
    const allTasks = await Task.find();
    const allBudgetItems = await BudgetItem.find();

    // Calculate portfolio metrics
    const totalBudget = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
    const totalSpent = projects.reduce((sum, p) => sum + (p.spent || 0), 0);
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.status === 'Done').length;
    const inProgressTasks = allTasks.filter(t => t.status === 'In Progress').length;

    // Project details
    const projectDetails = projects.map(project => {
      const projectTasks = allTasks.filter(t => t.projectId && t.projectId.toString() === project._id.toString());
      const projectBudgetItems = allBudgetItems.filter(b => b.projectId.toString() === project._id.toString());

      return {
        name: project.projectName,
        brand: project.brand,
        status: project.status,
        budget: project.budget,
        spent: project.spent,
        totalTasks: projectTasks.length,
        completedTasks: projectTasks.filter(t => t.status === 'Done').length,
        inProgressTasks: projectTasks.filter(t => t.status === 'In Progress').length,
        budgetItems: projectBudgetItems.length,
        startDate: project.startDate,
        endDate: project.endDate,
      };
    });

    // Budget by category
    const categories = ['Design', 'Approvals', 'Construction', 'Joinery', 'MEP', 'Fixtures', 'Contingency', 'Misc'];
    const budgetByCategory = categories.map(category => {
      const categoryItems = allBudgetItems.filter(b => b.category === category);
      return {
        category,
        items: categoryItems.length,
        amount: categoryItems.reduce((sum, b) => sum + (b.quantity * b.unitCost), 0),
      };
    });

    // Task status distribution
    const taskStatusDistribution = [
      { status: 'Backlog', count: allTasks.filter(t => t.status === 'Backlog').length },
      { status: 'In Progress', count: inProgressTasks },
      { status: 'Blocked', count: allTasks.filter(t => t.status === 'Blocked').length },
      { status: 'Done', count: completedTasks },
    ];

    res.json({
      summary: {
        totalProjects: projects.length,
        totalBudget,
        totalSpent,
        totalTasks,
        completedTasks,
        inProgressTasks,
        completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        budgetUtilization: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
      },
      projectDetails,
      budgetByCategory,
      taskStatusDistribution,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Generate portfolio PDF data error:', error);
    res.status(500).json({ message: 'Failed to generate portfolio PDF data' });
  }
});

// GENERATE Brand Report CSV
router.get('/reports/brand/:brandName/csv', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { brandName } = req.params;
    const projects = await Project.find({ brand: brandName });
    const projectIds = projects.map(p => p._id);
    const tasks = await Task.find({ projectId: { $in: projectIds } });
    const budgetItems = await BudgetItem.find({ projectId: { $in: projectIds } });

    const csvRows: string[][] = [];
    csvRows.push([`Report Type: ${brandName} Brand Report`, '', '', '', `Generated: ${new Date().toLocaleString()}`]);
    csvRows.push([]);

    csvRows.push(['BRAND SUMMARY']);
    csvRows.push(['Brand Name', brandName]);
    csvRows.push(['Total Projects', projects.length.toString()]);
    csvRows.push(['Total Budget', projects.reduce((sum, p) => sum + (p.budget || 0), 0).toString()]);
    csvRows.push(['Total Spent', projects.reduce((sum, p) => sum + (p.spent || 0), 0).toString()]);
    csvRows.push(['Total Tasks', tasks.length.toString()]);
    csvRows.push(['Completed Tasks', tasks.filter(t => t.status === 'Done').length.toString()]);
    csvRows.push([]);

    csvRows.push(['PROJECT DETAILS']);
    csvRows.push(['Project Name', 'Status', 'Budget', 'Spent', 'Tasks', 'Completed', 'Budget Items']);

    for (const project of projects) {
      const projectTasks = tasks.filter(t => t.projectId && t.projectId.toString() === project._id.toString());
      const projectBudgetItems = budgetItems.filter(b => b.projectId.toString() === project._id.toString());

      csvRows.push([
        project.projectName,
        project.status,
        project.budget.toString(),
        project.spent.toString(),
        projectTasks.length.toString(),
        projectTasks.filter(t => t.status === 'Done').length.toString(),
        projectBudgetItems.length.toString(),
      ]);
    }

    const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${brandName}-report-${Date.now()}.csv`);
    res.send(csvContent);
  } catch (error) {
    console.error('Generate brand CSV error:', error);
    res.status(500).json({ message: 'Failed to generate brand CSV' });
  }
});

// GENERATE Brand Report PDF Data
router.get('/reports/brand/:brandName/pdf-data', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { brandName } = req.params;
    const projects = await Project.find({ brand: brandName });
    const projectIds = projects.map(p => p._id);
    const tasks = await Task.find({ projectId: { $in: projectIds } });
    const budgetItems = await BudgetItem.find({ projectId: { $in: projectIds } });

    const totalBudget = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
    const totalSpent = projects.reduce((sum, p) => sum + (p.spent || 0), 0);

    const projectDetails = projects.map(project => {
      const projectTasks = tasks.filter(t => t.projectId && t.projectId.toString() === project._id.toString());
      const projectBudgetItems = budgetItems.filter(b => b.projectId.toString() === project._id.toString());

      return {
        name: project.projectName,
        status: project.status,
        budget: project.budget,
        spent: project.spent,
        totalTasks: projectTasks.length,
        completedTasks: projectTasks.filter(t => t.status === 'Done').length,
        budgetItems: projectBudgetItems.length,
      };
    });

    res.json({
      brandName,
      summary: {
        totalProjects: projects.length,
        totalBudget,
        totalSpent,
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === 'Done').length,
      },
      projectDetails,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Generate brand PDF data error:', error);
    res.status(500).json({ message: 'Failed to generate brand PDF data' });
  }
});

// GENERATE Project Report CSV
router.get('/reports/project/:projectId/csv', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const tasks = await Task.find({ projectId });
    const budgetItems = await BudgetItem.find({ projectId });

    const csvRows: string[][] = [];
    csvRows.push([`Project Report: ${project.projectName}`, '', '', '', `Generated: ${new Date().toLocaleString()}`]);
    csvRows.push([]);

    csvRows.push(['PROJECT INFORMATION']);
    csvRows.push(['Project Name', project.projectName]);
    csvRows.push(['Project Code', project.projectCode || 'N/A']);
    csvRows.push(['Brand', project.brand]);
    csvRows.push(['Status', project.status]);
    csvRows.push(['Budget', project.budget.toString()]);
    csvRows.push(['Spent', project.spent.toString()]);
    csvRows.push(['Start Date', project.startDate ? new Date(project.startDate).toLocaleDateString() : 'N/A']);
    csvRows.push(['End Date', project.endDate ? new Date(project.endDate).toLocaleDateString() : 'N/A']);
    csvRows.push([]);

    csvRows.push(['TASKS']);
    csvRows.push(['Title', 'Status', 'Priority', 'Assignees', 'Progress %', 'Due Date']);
    for (const task of tasks) {
      const assigneeNames = task.assignees.map(a => a.name).join('; ');
      csvRows.push([
        task.title,
        task.status,
        task.priority,
        assigneeNames || 'Unassigned',
        task.progress.toString(),
        task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'N/A',
      ]);
    }
    csvRows.push([]);

    csvRows.push(['BUDGET ITEMS']);
    csvRows.push(['Description', 'Category', 'Vendor', 'Quantity', 'Unit Cost', 'Total', 'Status']);
    for (const item of budgetItems) {
      csvRows.push([
        item.description,
        item.category,
        item.vendor,
        item.quantity.toString(),
        item.unitCost.toString(),
        (item.quantity * item.unitCost).toString(),
        item.committedStatus,
      ]);
    }

    const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${project.projectCode || project.projectName}-report-${Date.now()}.csv`);
    res.send(csvContent);
  } catch (error) {
    console.error('Generate project CSV error:', error);
    res.status(500).json({ message: 'Failed to generate project CSV' });
  }
});

// GENERATE Project Report PDF Data
router.get('/reports/project/:projectId/pdf-data', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const tasks = await Task.find({ projectId });
    const budgetItems = await BudgetItem.find({ projectId });

    const tasksByStatus = {
      backlog: tasks.filter(t => t.status === 'Backlog').length,
      inProgress: tasks.filter(t => t.status === 'In Progress').length,
      blocked: tasks.filter(t => t.status === 'Blocked').length,
      done: tasks.filter(t => t.status === 'Done').length,
    };

    const budgetByCategory = budgetItems.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = { items: 0, total: 0 };
      }
      acc[item.category].items++;
      acc[item.category].total += item.quantity * item.unitCost;
      return acc;
    }, {} as Record<string, { items: number; total: number }>);

    res.json({
      project: {
        name: project.projectName,
        code: project.projectCode,
        brand: project.brand,
        status: project.status,
        budget: project.budget,
        spent: project.spent,
        startDate: project.startDate,
        endDate: project.endDate,
        description: project.description,
      },
      tasks: tasks.map(t => ({
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignees: t.assignees.map(a => a.name),
        progress: t.progress,
        dueDate: t.dueDate,
      })),
      budgetItems: budgetItems.map(b => ({
        description: b.description,
        category: b.category,
        vendor: b.vendor,
        quantity: b.quantity,
        unitCost: b.unitCost,
        total: b.quantity * b.unitCost,
        status: b.committedStatus,
      })),
      summary: {
        totalTasks: tasks.length,
        tasksByStatus,
        totalBudgetItems: budgetItems.length,
        budgetByCategory,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Generate project PDF data error:', error);
    res.status(500).json({ message: 'Failed to generate project PDF data' });
  }
});

export default router;