import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import User from '../models/User';
import Project from '../models/Projects'; // Import Project model

const router = Router();

router.get('/dashboard', authMiddleware, adminOnly, (req, res) => {
  res.json({ message: 'Welcome Admin' });
});

// Get dashboard statistics
router.get('/dashboard/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    // Filter only regular users (not admins)
    const regularUsers = await User.find({ role: 'user' }).sort({ createdAt: 1 });

    // Get users grouped by date
    const usersByDate: { [key: string]: number } = {};

    regularUsers.forEach((user) => {
      const date = new Date(user.createdAt).toISOString().split('T')[0];
      usersByDate[date] = (usersByDate[date] || 0) + 1;
    });

    // Convert to array format for chart
    const chartData = Object.entries(usersByDate).map(([date, count]) => ({
      date,
      count,
    }));

    // Get project statistics
    const allProjects = await Project.find();
    
    const totalProjects = allProjects.length;
    const activeProjects = allProjects.filter(p => p.status === 'In Progress').length;
    const completedProjects = allProjects.filter(p => p.status === 'Completed').length;
    const planningProjects = allProjects.filter(p => p.status === 'Planning').length;
    
    // Calculate budget statistics
    const totalBudget = allProjects.reduce((sum, p) => sum + (p.budget || 0), 0);
    const totalSpent = allProjects.reduce((sum, p) => sum + (p.spent || 0), 0);
    const budgetUsedPercentage = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

    // Get projects from last month for comparison
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const projectsLastMonth = await Project.countDocuments({
      createdAt: { $lt: lastMonth }
    });
    const projectsThisMonth = await Project.countDocuments({
      createdAt: { $gte: lastMonth }
    });

    // Get projects from last week for active tasks comparison
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const activeLastWeek = await Project.countDocuments({
      status: 'In Progress',
      updatedAt: { $lt: lastWeek }
    });
    const activeChange = activeProjects - activeLastWeek;

    res.json({
      totalUsers: regularUsers.length,
      chartData: chartData.sort((a, b) => a.date.localeCompare(b.date)),
      users: regularUsers.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        subscriptionType: u.subscriptionType || 'N/A',
        totalProjects: u.totalProjects || 0,
        status: 'Active',
        createdAt: u.createdAt,
      })),
      // Project statistics
      projectStats: {
        totalProjects,
        activeProjects,
        completedProjects,
        planningProjects,
        budgetUsedPercentage,
        projectsThisMonth,
        activeChange,
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard stats' });
  }
});

export default router;