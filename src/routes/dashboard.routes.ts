import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Project from '../models/Projects';
import Task from '../models/Task';
import BudgetItem from '../models/BudgetItem';
import Brand from '../models/Brand';

const router = Router();

// GET dashboard statistics
router.get('/dashboard/stats', authMiddleware, adminOnly, async (_req, res) => {
  try {
    console.log('=== Dashboard Stats Request Started ===');

    // =====================================
    // Projects
    // =====================================
    const projects = await Project.find();
    console.log(`Found ${projects.length} projects`);

    // =====================================
    // Project Stats
    // =====================================
    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status === 'In Progress').length;
    const completedProjects = projects.filter(p => p.status === 'Completed').length;
    const planningProjects = projects.filter(p => p.status === 'Planning').length;

    const totalBudget = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
    const totalSpent = projects.reduce((sum, p) => sum + (p.spent || 0), 0);
    const budgetUsedPercentage =
      totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

    // =====================================
    // Time-based metrics
    // =====================================
    const now = new Date();

    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const projectsThisMonth = projects.filter(
      p => new Date(p.createdAt) >= lastMonth
    ).length;

    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const activeLastWeek = projects.filter(
      p =>
        p.status === 'In Progress' &&
        new Date(p.updatedAt) < lastWeek
    ).length;

    const activeChange = activeProjects - activeLastWeek;

    // =====================================
    // Project Analytics (USED ELSEWHERE)
    // =====================================
    const projectAnalytics = await Promise.all(
      projects.map(async project => {
        const projectTasks = await Task.find({ projectId: project._id });
        const projectBudgetItems = await BudgetItem.find({
          projectId: project._id,
        });

        return {
          projectId: project._id,
          projectName: project.projectName,
          brand: project.brand,
          taskStatusData: [
            { status: 'Backlog', count: projectTasks.filter(t => t.status === 'Backlog').length },
            { status: 'In Progress', count: projectTasks.filter(t => t.status === 'In Progress').length },
            { status: 'Blocked', count: projectTasks.filter(t => t.status === 'Blocked').length },
            { status: 'Done', count: projectTasks.filter(t => t.status === 'Done').length },
          ],
          budgetStatusData: [
            {
              status: 'Planned',
              amount: projectBudgetItems
                .filter(b => b.committedStatus === 'Planned')
                .reduce((s, b) => s + b.quantity * b.unitCost, 0),
            },
            {
              status: 'Committed',
              amount: projectBudgetItems
                .filter(b => b.committedStatus === 'Committed')
                .reduce((s, b) => s + b.quantity * b.unitCost, 0),
            },
            {
              status: 'Invoiced',
              amount: projectBudgetItems
                .filter(b => b.committedStatus === 'Invoiced')
                .reduce((s, b) => s + b.quantity * b.unitCost, 0),
            },
            {
              status: 'Paid',
              amount: projectBudgetItems
                .filter(b => b.committedStatus === 'Paid')
                .reduce((s, b) => s + b.quantity * b.unitCost, 0),
            },
          ],
          totalTasks: projectTasks.length,
          completedTasks: projectTasks.filter(t => t.status === 'Done').length,
          totalBudget: project.budget,
          totalSpent: project.spent,
        };
      })
    );

    // =====================================
    // Brand Analytics
    // =====================================
    const brands = await Brand.find({ isActive: true });

    const brandAnalytics = await Promise.all(
      brands.map(async brand => {
        const brandProjects = projects.filter(p => p.brand === brand.name);
        const brandProjectIds = brandProjects.map(p => p._id);

        const brandTasks = await Task.find({
          projectId: { $in: brandProjectIds },
        });
        const brandBudgetItems = await BudgetItem.find({
          projectId: { $in: brandProjectIds },
        });

        return {
          brandId: brand._id,
          brandName: brand.name,
          projectCount: brandProjects.length,
          taskStatusData: [
            { status: 'Backlog', count: brandTasks.filter(t => t.status === 'Backlog').length },
            { status: 'In Progress', count: brandTasks.filter(t => t.status === 'In Progress').length },
            { status: 'Blocked', count: brandTasks.filter(t => t.status === 'Blocked').length },
            { status: 'Done', count: brandTasks.filter(t => t.status === 'Done').length },
          ],
          budgetStatusData: [
            {
              status: 'Planned',
              amount: brandBudgetItems
                .filter(b => b.committedStatus === 'Planned')
                .reduce((s, b) => s + b.quantity * b.unitCost, 0),
            },
            {
              status: 'Committed',
              amount: brandBudgetItems
                .filter(b => b.committedStatus === 'Committed')
                .reduce((s, b) => s + b.quantity * b.unitCost, 0),
            },
            {
              status: 'Invoiced',
              amount: brandBudgetItems
                .filter(b => b.committedStatus === 'Invoiced')
                .reduce((s, b) => s + b.quantity * b.unitCost, 0),
            },
            {
              status: 'Paid',
              amount: brandBudgetItems
                .filter(b => b.committedStatus === 'Paid')
                .reduce((s, b) => s + b.quantity * b.unitCost, 0),
            },
          ],
          totalTasks: brandTasks.length,
          completedTasks: brandTasks.filter(t => t.status === 'Done').length,
          totalBudget: brandProjects.reduce((s, p) => s + (p.budget || 0), 0),
          totalSpent: brandProjects.reduce((s, p) => s + (p.spent || 0), 0),
        };
      })
    );

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
      projectAnalytics,
      brandAnalytics,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      message: 'Failed to fetch dashboard statistics',
    });
  }
});

export default router;
