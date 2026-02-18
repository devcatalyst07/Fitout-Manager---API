import express from "express";
import { authMiddleware } from "../middleware/auth";
import { requireAdmin as adminOnly } from "../middleware/permissions";
import User from "../models/User";
import Project from "../models/Projects"; // Import Project model
import Notification from "../models/Notification";
import Role from "../models/Role";
import { invalidateUserCache } from "../utils/cache";

const router = express.Router();

router.get(
  "/dashboard",
  authMiddleware,
  adminOnly,
  (req: express.Request, res: express.Response) => {
    res.json({ message: "Welcome Admin" });
  },
);

// Get dashboard statistics
router.get(
  "/dashboard/stats",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      // Filter only regular users (not admins)
      const regularUsers = await User.find({ role: "user" }).sort({
        createdAt: 1,
      });

      // Get users grouped by date
      const usersByDate: { [key: string]: number } = {};

      regularUsers.forEach((user) => {
        const date = new Date(user.createdAt).toISOString().split("T")[0];
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
      const activeProjects = allProjects.filter(
        (p) => p.status === "In Progress",
      ).length;
      const completedProjects = allProjects.filter(
        (p) => p.status === "Completed",
      ).length;
      const planningProjects = allProjects.filter(
        (p) => p.status === "Planning",
      ).length;

      // Calculate budget statistics
      const totalBudget = allProjects.reduce(
        (sum, p) => sum + (p.budget || 0),
        0,
      );
      const totalSpent = allProjects.reduce(
        (sum, p) => sum + (p.spent || 0),
        0,
      );
      const budgetUsedPercentage =
        totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

      // Get projects from last month for comparison
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const projectsLastMonth = await Project.countDocuments({
        createdAt: { $lt: lastMonth },
      });
      const projectsThisMonth = await Project.countDocuments({
        createdAt: { $gte: lastMonth },
      });

      // Get projects from last week for active tasks comparison
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);
      const activeLastWeek = await Project.countDocuments({
        status: "In Progress",
        updatedAt: { $lt: lastWeek },
      });
      const activeChange = activeProjects - activeLastWeek;

      res.json({
        totalUsers: regularUsers.length,
        chartData: chartData.sort((a, b) => a.date.localeCompare(b.date)),
        users: regularUsers.map((u) => ({
          id: u._id,
          name: u.name,
          email: u.email,
          subscriptionType: u.subscriptionType || "N/A",
          totalProjects: u.totalProjects || 0,
          status: "Active",
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
        },
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  },
);

// Get all non-admin users (for role assignment)
router.get(
  "/users",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const users = await User.find({ role: "user" })
        .select(
          "name email roleId roleRequestPending roleRequestSentTo roleRequestSentAt",
        )
        .sort({ name: 1 });

      res.json(
        users.map((u) => ({
          id: u._id,
          name: u.name,
          email: u.email,
          roleId: u.roleId?.toString() || null,
          roleRequestPending: u.roleRequestPending || false,
          roleRequestSentTo: u.roleRequestSentTo,
          roleRequestSentAt: u.roleRequestSentAt,
        })),
      );
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  },
);

// Assign a global role to a user
router.put(
  "/users/:userId/role",
  authMiddleware,
  adminOnly,
  async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.params;
      const { roleId } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const user = await User.findById(userId);
      if (!user || user.role === "admin") {
        return res.status(404).json({ message: "User not found" });
      }

      // Track if we're removing a role
      const isPreviouslyAssigned = !!user.roleId;
      const isRemoving = !roleId;

      // Get role info if roleId is provided
      let roleInfo = null;
      if (roleId) {
        roleInfo = await Role.findById(roleId);
      }

      // Get previous role name for notification
      let previousRoleName = null;
      if (isPreviouslyAssigned && isRemoving) {
        const previousRole = await Role.findById(user.roleId);
        previousRoleName = previousRole?.name;
      }

      // roleId can be null to remove role assignment
      await User.findByIdAndUpdate(userId, {
        roleId: roleId || null,
        // Clear pending role request flags when assigning role
        roleRequestPending: false,
        roleRequestSentTo: undefined,
        roleRequestSentAt: undefined,
      });

      // Send notification to user if role was assigned (not removed)
      if (roleId && roleInfo) {
        await Notification.create({
          type: "role_assigned",
          recipientId: user._id,
          recipientEmail: user.email,
          title: "Role Assigned",
          message: `You have been assigned the role: ${roleInfo.name}. You can now access the platform.`,
          isRead: false,
          actionUrl: "/user/dashboard",
          metadata: {
            roleId: roleId,
            roleName: roleInfo.name,
            assignedBy: req.user?.name || "Admin",
          },
        });

        console.log(
          `Role ${roleInfo.name} assigned to user ${user.email}, notification created`,
        );
      }
      // Send notification when role is removed
      else if (isRemoving && isPreviouslyAssigned) {
        await Notification.create({
          type: "role_removed",
          recipientId: user._id,
          recipientEmail: user.email,
          title: "Role Access Revoked",
          message: `Your role assignment has been revoked${previousRoleName ? ` (${previousRoleName})` : ""}. You no longer have access to the platform. Please contact an administrator if you believe this is a mistake.`,
          isRead: false,
          actionUrl: "/",
          metadata: {
            removedBy: req.user?.name || "Admin",
            previousRoleName: previousRoleName,
          },
        });

        console.log(
          `Role revoked for user ${user.email}, notification created`,
        );
      }

      // Invalidate user cache so next request picks up new role
      await invalidateUserCache(userId);

      res.json({ message: "Role assigned successfully" });
    } catch (error) {
      console.error("Assign role error:", error);
      res.status(500).json({ message: "Failed to assign role" });
    }
  },
);

export default router;
