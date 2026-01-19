import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Project from '../models/Projects';
import Task from '../models/Task';
import BudgetItem from '../models/BudgetItem';
import Brand from '../models/Brand';
import mongoose from 'mongoose';

const router = Router();

// GET dashboard statistics
router.get('/dashboard/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    console.log('=== Dashboard Stats Request Started ===');
    
    // Get all projects
    const projects = await Project.find().populate('userId', 'name email');
    console.log(`Found ${projects.length} projects`);
    
    // Debug: Log project details
    projects.forEach(p => {
      console.log(`Project: ${p.projectName}, Status: ${p.status}, ID: ${p._id}`);
    });
    
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

    // ========== ACTIVE TASKS - FIXED APPROACH ==========
    console.log('Fetching active tasks...');
    
    // Get project IDs that are not completed
    const activeProjectIds = projects
      .filter(p => p.status !== 'Completed')
      .map(p => p._id);

    console.log(`Active project IDs count: ${activeProjectIds.length}`);
    console.log('Active project IDs:', activeProjectIds.map(id => id.toString()));

    // First, check ALL tasks regardless of project
    const allTasksCheck = await Task.find().lean();
    console.log(`Total tasks in database: ${allTasksCheck.length}`);
    allTasksCheck.forEach(t => {
      console.log(`Task: ${t.title}, Status: ${t.status}, ProjectID: ${t.projectId}`);
    });

    // Query tasks directly with projectId filter
    const activeTasks = await Task.find({ 
      projectId: { $in: activeProjectIds },
      status: { $in: ['Backlog', 'In Progress', 'Blocked'] } 
    })
    .sort({ dueDate: 1 })
    .limit(10)
    .lean(); // Use lean() for better performance

    console.log(`Found ${activeTasks.length} active tasks from database query`);

    // Manually populate project data
    const activeTasksPopulated = activeTasks.map(task => {
      const project = projects.find(p => p._id.toString() === task.projectId.toString());
      return {
        _id: task._id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        assignees: task.assignees || [],
        projectId: project ? {
          _id: project._id,
          projectName: project.projectName,
          brand: project.brand
        } : null
      };
    }).filter(task => task.projectId !== null); // Remove tasks with invalid projects

    console.log(`Valid active tasks after population: ${activeTasksPopulated.length}`);

    // ========== BUDGET ITEMS - FIXED APPROACH ==========
    console.log('Fetching budget items...');

    // First, check ALL budget items
    const allBudgetCheck = await BudgetItem.find().lean();
    console.log(`Total budget items in database: ${allBudgetCheck.length}`);
    allBudgetCheck.forEach(b => {
      console.log(`Budget: ${b.description}, Status: ${b.committedStatus}, ProjectID: ${b.projectId}`);
    });

    // Query budget items directly with projectId filter
    const budgetItems = await BudgetItem.find({ 
      projectId: { $in: activeProjectIds }
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

    console.log(`Found ${budgetItems.length} budget items from database query`);

    // Manually populate project data
    const budgetTasksPopulated = budgetItems.map(item => {
      const project = projects.find(p => p._id.toString() === item.projectId.toString());
      return {
        _id: item._id,
        description: item.description,
        vendor: item.vendor,
        quantity: item.quantity,
        unitCost: item.unitCost,
        committedStatus: item.committedStatus,
        category: item.category,
        projectId: project ? {
          _id: project._id,
          projectName: project.projectName,
          brand: project.brand
        } : null
      };
    }).filter(item => item.projectId !== null); // Remove items with invalid projects

    console.log(`Valid budget items after population: ${budgetTasksPopulated.length}`);

    // ========== PROJECT ANALYTICS - FIXED ==========
    console.log('Calculating project analytics...');
    
    // Get all tasks and budget items once
    const allTasks = await Task.find().lean();
    const allBudgetItems = await BudgetItem.find().lean();
    
    console.log(`Total tasks in DB: ${allTasks.length}`);
    console.log(`Total budget items in DB: ${allBudgetItems.length}`);

    const projectAnalytics = projects.map(project => {
      const projectIdStr = project._id.toString();
      const projectTasks = allTasks.filter(t => t.projectId.toString() === projectIdStr);
      const projectBudgetItems = allBudgetItems.filter(b => b.projectId.toString() === projectIdStr);

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
    });

    console.log(`Generated analytics for ${projectAnalytics.length} projects`);

    // ========== BRAND ANALYTICS - FIXED ==========
    console.log('Calculating brand analytics...');
    const brands = await Brand.find({ isActive: true });
    console.log(`Found ${brands.length} active brands`);
    
    const brandAnalytics = brands.map(brand => {
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
    });

    console.log(`Generated analytics for ${brandAnalytics.length} brands`);
    
    // Final summary
    console.log('=== FINAL RESPONSE SUMMARY ===');
    console.log(`Projects: ${totalProjects}`);
    console.log(`Active Tasks to send: ${activeTasksPopulated.length}`);
    console.log(`Budget Items to send: ${budgetTasksPopulated.length}`);
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
      activeTasks: activeTasksPopulated,
      budgetTasks: budgetTasksPopulated,
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