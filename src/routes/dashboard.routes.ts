import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Project from '../models/Projects';
import Task from '../models/Task';
import BudgetItem from '../models/BudgetItem';
import Brand from '../models/Brand';

const router = Router();

// GET dashboard statistics
router.get('/dashboard/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    // Get all projects
    const projects = await Project.find().populate('userId', 'name email');
    
    // Get all tasks
    const tasks = await Task.find();
    
    // Get all budget items
    const budgetItems = await BudgetItem.find();

    // Calculate project stats
    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status === 'In Progress').length;
    const completedProjects = projects.filter(p => p.status === 'Completed').length;
    const planningProjects = projects.filter(p => p.status === 'Planning').length;

    // Calculate budget stats
    const totalBudget = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
    const totalSpent = projects.reduce((sum, p) => sum + (p.spent || 0), 0);
    const budgetUsedPercentage = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

    // Project stats for monthly change
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const projectsThisMonth = projects.filter(p => 
      new Date(p.createdAt) >= lastMonth
    ).length;

    // Active change (week over week)
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const activeLastWeek = projects.filter(p => 
      p.status === 'In Progress' && new Date(p.updatedAt) < lastWeek
    ).length;
    const activeChange = activeProjects - activeLastWeek;

    // Get active tasks grouped by project
    const activeTasks = await Task.find({ status: { $ne: 'Done' } })
      .populate('projectId', 'projectName brand')
      .sort({ dueDate: 1 })
      .limit(10);

    // Get budget items grouped by project (high priority items)
    const budgetTasks = await BudgetItem.find({ 
      committedStatus: { $in: ['Planned', 'Committed'] } 
    })
      .populate('projectId', 'projectName brand')
      .sort({ createdAt: -1 })
      .limit(10);

    // Project analytics data
    const projectAnalytics = await Promise.all(
      projects.map(async (project) => {
        const projectTasks = await Task.find({ projectId: project._id });
        const projectBudgetItems = await BudgetItem.find({ projectId: project._id });

        // Task status breakdown
        const taskStatusData = [
          { status: 'Backlog', count: projectTasks.filter(t => t.status === 'Backlog').length },
          { status: 'In Progress', count: projectTasks.filter(t => t.status === 'In Progress').length },
          { status: 'Blocked', count: projectTasks.filter(t => t.status === 'Blocked').length },
          { status: 'Done', count: projectTasks.filter(t => t.status === 'Done').length },
        ];

        // Budget status breakdown
        const budgetStatusData = [
          { status: 'Planned', amount: projectBudgetItems.filter(b => b.committedStatus === 'Planned').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
          { status: 'Committed', amount: projectBudgetItems.filter(b => b.committedStatus === 'Committed').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
          { status: 'Invoiced', amount: projectBudgetItems.filter(b => b.committedStatus === 'Invoiced').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
          { status: 'Paid', amount: projectBudgetItems.filter(b => b.committedStatus === 'Paid').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
        ];

        return {
          projectId: project._id,
          projectName: project.projectName,
          brand: project.brand,
          taskStatusData,
          budgetStatusData,
          totalTasks: projectTasks.length,
          completedTasks: projectTasks.filter(t => t.status === 'Done').length,
          totalBudget: project.budget,
          totalSpent: project.spent,
        };
      })
    );

    // Brand analytics
    const brands = await Brand.find({ isActive: true });
    const brandAnalytics = await Promise.all(
      brands.map(async (brand) => {
        const brandProjects = projects.filter(p => p.brand === brand.name);
        const brandProjectIds = brandProjects.map(p => p._id);
        
        const brandTasks = await Task.find({ projectId: { $in: brandProjectIds } });
        const brandBudgetItems = await BudgetItem.find({ projectId: { $in: brandProjectIds } });

        // Task status breakdown for brand
        const taskStatusData = [
          { status: 'Backlog', count: brandTasks.filter(t => t.status === 'Backlog').length },
          { status: 'In Progress', count: brandTasks.filter(t => t.status === 'In Progress').length },
          { status: 'Blocked', count: brandTasks.filter(t => t.status === 'Blocked').length },
          { status: 'Done', count: brandTasks.filter(t => t.status === 'Done').length },
        ];

        // Budget status breakdown for brand
        const budgetStatusData = [
          { status: 'Planned', amount: brandBudgetItems.filter(b => b.committedStatus === 'Planned').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
          { status: 'Committed', amount: brandBudgetItems.filter(b => b.committedStatus === 'Committed').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
          { status: 'Invoiced', amount: brandBudgetItems.filter(b => b.committedStatus === 'Invoiced').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
          { status: 'Paid', amount: brandBudgetItems.filter(b => b.committedStatus === 'Paid').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
        ];

        return {
          brandId: brand._id,
          brandName: brand.name,
          projectCount: brandProjects.length,
          taskStatusData,
          budgetStatusData,
          totalTasks: brandTasks.length,
          completedTasks: brandTasks.filter(t => t.status === 'Done').length,
          totalBudget: brandProjects.reduce((sum, p) => sum + (p.budget || 0), 0),
          totalSpent: brandProjects.reduce((sum, p) => sum + (p.spent || 0), 0),
        };
      })
    );

    res.json({
      projectStats: {
        totalProjects,
        activeProjects,
        completedProjects,
        planningProjects,
        budgetUsedPercentage,
        projectsThisMonth,
        activeChange,
      },
      activeTasks,
      budgetTasks,
      projectAnalytics,
      brandAnalytics,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
  }
});

export default router;