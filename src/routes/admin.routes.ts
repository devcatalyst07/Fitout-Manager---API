import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import User from '../models/User';

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
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard stats' });
  }
});

export default router;