import ProjectActivity from "../models/ProjectActivity";

export const logProjectActivity = async (data: {
  projectId: string;
  type: "budget" | "task" | "approval" | "team" | "document" | "system";
  action: string;
  description: string;
  userId?: string;
  userName?: string;
  metadata?: any;
}) => {
  try {
    await ProjectActivity.create(data);
  } catch (error) {
    console.error("Failed to log project activity:", error);
  }
};

// Helper functions for common activities
export const activityHelpers = {
  budgetCreated: (
    projectId: string,
    userId: string,
    userName: string,
    amount: number,
    category: string,
  ) => {
    return logProjectActivity({
      projectId,
      type: "budget",
      action: "budget_created",
      description: `Budget item added: ${category} - $${amount.toLocaleString()}`,
      userId,
      userName,
      metadata: {
        budgetAmount: amount,
        budgetCategory: category,
      },
    });
  },

  taskCompleted: (
    projectId: string,
    userId: string,
    userName: string,
    taskTitle: string,
    taskId: string,
  ) => {
    return logProjectActivity({
      projectId,
      type: "task",
      action: "task_completed",
      description: `Task completed: "${taskTitle}"`,
      userId,
      userName,
      metadata: {
        taskId,
        taskTitle,
      },
    });
  },

  approvalSubmitted: (
    projectId: string,
    userId: string,
    userName: string,
    approvalType: string,
  ) => {
    return logProjectActivity({
      projectId,
      type: "approval",
      action: "approval_submitted",
      description: `Approval submitted: ${approvalType}`,
      userId,
      userName,
      metadata: {
        approvalType,
      },
    });
  },

  teamMemberAdded: (
    projectId: string,
    userId: string,
    userName: string,
    memberName: string,
  ) => {
    return logProjectActivity({
      projectId,
      type: "team",
      action: "team_member_added",
      description: `${memberName} joined the project`,
      userId,
      userName,
      metadata: {
        teamMemberName: memberName,
      },
    });
  },

  tasksOverdue: (projectId: string, count: number) => {
    return logProjectActivity({
      projectId,
      type: "system",
      action: "tasks_overdue",
      description: `${count} tasks are past due date`,
      metadata: {
        severity: "critical",
      },
    });
  },

  budgetThreshold: (projectId: string, percentage: number) => {
    const severity = percentage >= 90 ? "critical" : "warning";
    return logProjectActivity({
      projectId,
      type: "system",
      action: "budget_threshold",
      description: `Budget utilization reached ${percentage.toFixed(1)}%`,
      metadata: {
        severity,
      },
    });
  },
};
