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
    console.log('=== Dashboard Stats Request Started ===');
    
    // Get all projects
    const projects = await Project.find().populate('userId', 'name email');
    console.log(`Found ${projects.length} projects`);
    
    // Get all tasks
    const tasks = await Task.find();
    console.log(`Found ${tasks.length} total tasks`);
    
    // Get all budget items
    const budgetItems = await BudgetItem.find();
    console.log(`Found ${budgetItems.length} total budget items`);

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

    // Get active tasks (NOT Done) - FIXED
    console.log('Fetching active tasks...');
    const activeTasksQuery = await Task.find({ 
      status: { $in: ['Backlog', 'In Progress', 'Blocked'] } 
    })
      .populate({
        path: 'projectId',
        select: 'projectName brand',
        model: 'Project'
      })
      .sort({ dueDate: 1 })
      .limit(10)
      .lean();

    console.log(`Found ${activeTasksQuery.length} active tasks before filtering`);
    
    // Filter out any tasks where projectId didn't populate
    const activeTasks = activeTasksQuery.filter(task => {
      const isValid = task.projectId && typeof task.projectId === 'object';
      if (!isValid) {
        console.log(`Filtered out task ${task._id} - projectId not populated`);
      }
      return isValid;
    });
    
    console.log(`Valid active tasks after filtering: ${activeTasks.length}`);

    // Get budget items for ALL projects (including active ones)
    console.log('Fetching budget items...');
    const activeProjectIds = projects
      .filter(p => p.status !== 'Completed')
      .map(p => p._id);
    
    console.log(`Active project IDs count: ${activeProjectIds.length}`);

    const budgetTasksQuery = await BudgetItem.find({ 
      projectId: { $in: activeProjectIds }
    })
      .populate({
        path: 'projectId',
        select: 'projectName brand',
        model: 'Project'
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log(`Found ${budgetTasksQuery.length} budget items before filtering`);

    // Filter out any budget items where projectId didn't populate
    const budgetTasks = budgetTasksQuery.filter(item => {
      const isValid = item.projectId && typeof item.projectId === 'object';
      if (!isValid) {
        console.log(`Filtered out budget item ${item._id} - projectId not populated`);
      }
      return isValid;
    });

    console.log(`Valid budget items after filtering: ${budgetTasks.length}`);

    // Project analytics data
    console.log('Calculating project analytics...');
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

    console.log(`Generated analytics for ${projectAnalytics.length} projects`);

    // Brand analytics
    console.log('Calculating brand analytics...');
    const brands = await Brand.find({ isActive: true });
    console.log(`Found ${brands.length} active brands`);
    
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

    console.log(`Generated analytics for ${brandAnalytics.length} brands`);
    console.log('=== Dashboard Stats Request Completed ===');

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
    res.status(500).json({ message: 'Failed to fetch dashboard statistics', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;