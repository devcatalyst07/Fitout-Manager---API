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
    const allTasks = await Task.find();
    console.log(`Found ${allTasks.length} total tasks`);
    
    // Get all budget items
    const allBudgetItems = await BudgetItem.find();
    console.log(`Found ${allBudgetItems.length} total budget items`);

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

    // ========== ACTIVE TASKS - SIMPLIFIED APPROACH ==========
    console.log('Fetching active tasks...');
    
    // Get all non-Done tasks
    const activeTasksRaw = await Task.find({ 
      status: { $in: ['Backlog', 'In Progress', 'Blocked'] } 
    }).sort({ dueDate: 1 }).limit(10);

    console.log(`Found ${activeTasksRaw.length} active tasks`);

    // Manually populate project data
    const activeTasks = [];
    for (const task of activeTasksRaw) {
      const project = projects.find(p => p._id.toString() === task.projectId.toString());
      if (project) {
        activeTasks.push({
          _id: task._id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          assignees: task.assignees || [],
          projectId: {
            _id: project._id,
            projectName: project.projectName,
            brand: project.brand
          }
        });
      } else {
        console.log(`Warning: Task ${task._id} has invalid projectId: ${task.projectId}`);
      }
    }
    
    console.log(`Valid active tasks: ${activeTasks.length}`);
    console.log('Active tasks sample:', activeTasks.length > 0 ? activeTasks[0] : 'none');

    // ========== BUDGET ITEMS - SIMPLIFIED APPROACH ==========
    console.log('Fetching budget items...');
    
    // Get active project IDs (not completed)
    const activeProjectIds = projects
      .filter(p => p.status !== 'Completed')
      .map(p => p._id.toString());
    
    console.log(`Active project IDs count: ${activeProjectIds.length}`);

    // Get budget items from active projects
    const budgetItemsRaw = await BudgetItem.find().sort({ createdAt: -1 }).limit(50);
    
    console.log(`Found ${budgetItemsRaw.length} budget items total`);

    // Manually populate and filter
    const budgetTasks = [];
    for (const item of budgetItemsRaw) {
      const project = projects.find(p => p._id.toString() === item.projectId.toString());
      
      // Include if project exists AND is not completed
      if (project && activeProjectIds.includes(project._id.toString())) {
        budgetTasks.push({
          _id: item._id,
          description: item.description,
          vendor: item.vendor,
          quantity: item.quantity,
          unitCost: item.unitCost,
          committedStatus: item.committedStatus,
          category: item.category,
          projectId: {
            _id: project._id,
            projectName: project.projectName,
            brand: project.brand
          }
        });
        
        if (budgetTasks.length >= 10) break; // Limit to 10
      }
    }

    console.log(`Valid budget items: ${budgetTasks.length}`);
    console.log('Budget items sample:', budgetTasks.length > 0 ? budgetTasks[0] : 'none');

    // ========== PROJECT ANALYTICS ==========
    console.log('Calculating project analytics...');
    const projectAnalytics = [];
    
    for (const project of projects) {
      const projectTasks = allTasks.filter(t => t.projectId.toString() === project._id.toString());
      const projectBudgetItems = allBudgetItems.filter(b => b.projectId.toString() === project._id.toString());

      const taskStatusData = [
        { status: 'Backlog', count: projectTasks.filter(t => t.status === 'Backlog').length },
        { status: 'In Progress', count: projectTasks.filter(t => t.status === 'In Progress').length },
        { status: 'Blocked', count: projectTasks.filter(t => t.status === 'Blocked').length },
        { status: 'Done', count: projectTasks.filter(t => t.status === 'Done').length },
      ];

      const budgetStatusData = [
        { status: 'Planned', amount: projectBudgetItems.filter(b => b.committedStatus === 'Planned').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
        { status: 'Committed', amount: projectBudgetItems.filter(b => b.committedStatus === 'Committed').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
        { status: 'Invoiced', amount: projectBudgetItems.filter(b => b.committedStatus === 'Invoiced').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
        { status: 'Paid', amount: projectBudgetItems.filter(b => b.committedStatus === 'Paid').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
      ];

      projectAnalytics.push({
        projectId: project._id,
        projectName: project.projectName,
        brand: project.brand,
        taskStatusData,
        budgetStatusData,
        totalTasks: projectTasks.length,
        completedTasks: projectTasks.filter(t => t.status === 'Done').length,
        totalBudget: project.budget,
        totalSpent: project.spent,
      });
    }

    console.log(`Generated analytics for ${projectAnalytics.length} projects`);

    // ========== BRAND ANALYTICS ==========
    console.log('Calculating brand analytics...');
    const brands = await Brand.find({ isActive: true });
    console.log(`Found ${brands.length} active brands`);
    
    const brandAnalytics = [];
    
    for (const brand of brands) {
      const brandProjects = projects.filter(p => p.brand === brand.name);
      const brandProjectIds = brandProjects.map(p => p._id.toString());
      
      const brandTasks = allTasks.filter(t => brandProjectIds.includes(t.projectId.toString()));
      const brandBudgetItems = allBudgetItems.filter(b => brandProjectIds.includes(b.projectId.toString()));

      const taskStatusData = [
        { status: 'Backlog', count: brandTasks.filter(t => t.status === 'Backlog').length },
        { status: 'In Progress', count: brandTasks.filter(t => t.status === 'In Progress').length },
        { status: 'Blocked', count: brandTasks.filter(t => t.status === 'Blocked').length },
        { status: 'Done', count: brandTasks.filter(t => t.status === 'Done').length },
      ];

      const budgetStatusData = [
        { status: 'Planned', amount: brandBudgetItems.filter(b => b.committedStatus === 'Planned').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
        { status: 'Committed', amount: brandBudgetItems.filter(b => b.committedStatus === 'Committed').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
        { status: 'Invoiced', amount: brandBudgetItems.filter(b => b.committedStatus === 'Invoiced').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
        { status: 'Paid', amount: brandBudgetItems.filter(b => b.committedStatus === 'Paid').reduce((sum, b) => sum + (b.quantity * b.unitCost), 0) },
      ];

      brandAnalytics.push({
        brandId: brand._id,
        brandName: brand.name,
        projectCount: brandProjects.length,
        taskStatusData,
        budgetStatusData,
        totalTasks: brandTasks.length,
        completedTasks: brandTasks.filter(t => t.status === 'Done').length,
        totalBudget: brandProjects.reduce((sum, p) => sum + (p.budget || 0), 0),
        totalSpent: brandProjects.reduce((sum, p) => sum + (p.spent || 0), 0),
      });
    }

    console.log(`Generated analytics for ${brandAnalytics.length} brands`);
    
    // Final summary
    console.log('=== FINAL RESPONSE SUMMARY ===');
    console.log(`Projects: ${totalProjects}`);
    console.log(`Active Tasks to send: ${activeTasks.length}`);
    console.log(`Budget Items to send: ${budgetTasks.length}`);
    console.log(`Project Analytics: ${projectAnalytics.length}`);
    console.log(`Brand Analytics: ${brandAnalytics.length}`);
    console.log('=== Dashboard Stats Request Completed ===');

    const response = {
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
    };

    res.json(response);
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch dashboard statistics', 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

export default router;