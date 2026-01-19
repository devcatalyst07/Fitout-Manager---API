import ProjectActivity from '../models/ProjectActivity';
import mongoose from 'mongoose';

export const activityHelpers = {
  // Budget Activities
  budgetCreated: async (
    projectId: string,
    userId: string,
    userName: string,
    amount: number,
    category: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'budget',
        action: 'budget_item_created',
        description: `${userName} added a new budget item in ${category} category`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          budgetAmount: amount,
          budgetCategory: category,
        },
      });
    } catch (error) {
      console.error('Activity log error (budgetCreated):', error);
    }
  },

  budgetUpdated: async (
    projectId: string,
    userId: string,
    userName: string,
    amount: number,
    category: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'budget',
        action: 'budget_item_updated',
        description: `${userName} updated a budget item in ${category} category`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          budgetAmount: amount,
          budgetCategory: category,
        },
      });
    } catch (error) {
      console.error('Activity log error (budgetUpdated):', error);
    }
  },

  budgetDeleted: async (
    projectId: string,
    userId: string,
    userName: string,
    category: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'budget',
        action: 'budget_item_deleted',
        description: `${userName} deleted a budget item from ${category} category`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          budgetCategory: category,
        },
      });
    } catch (error) {
      console.error('Activity log error (budgetDeleted):', error);
    }
  },

  // Task Activities
  taskCreated: async (
    projectId: string,
    userId: string,
    userName: string,
    taskTitle: string,
    taskId: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'task',
        action: 'task_created',
        description: `${userName} created task "${taskTitle}"`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          taskId,
          taskTitle,
        },
      });
    } catch (error) {
      console.error('Activity log error (taskCreated):', error);
    }
  },

  taskUpdated: async (
    projectId: string,
    userId: string,
    userName: string,
    taskTitle: string,
    taskId: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'task',
        action: 'task_updated',
        description: `${userName} updated task "${taskTitle}"`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          taskId,
          taskTitle,
        },
      });
    } catch (error) {
      console.error('Activity log error (taskUpdated):', error);
    }
  },

  taskCompleted: async (
    projectId: string,
    userId: string,
    userName: string,
    taskTitle: string,
    taskId: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'task',
        action: 'task_completed',
        description: `${userName} completed task "${taskTitle}"`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          taskId,
          taskTitle,
          severity: 'info',
        },
      });
    } catch (error) {
      console.error('Activity log error (taskCompleted):', error);
    }
  },

  taskDeleted: async (
    projectId: string,
    userId: string,
    userName: string,
    taskTitle: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'task',
        action: 'task_deleted',
        description: `${userName} deleted task "${taskTitle}"`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          taskTitle,
        },
      });
    } catch (error) {
      console.error('Activity log error (taskDeleted):', error);
    }
  },

  // Team Activities
  teamMemberAdded: async (
    projectId: string,
    userId: string,
    userName: string,
    memberName: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'team',
        action: 'team_member_added',
        description: `${userName} added ${memberName} to the team`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          teamMemberName: memberName,
        },
      });
    } catch (error) {
      console.error('Activity log error (teamMemberAdded):', error);
    }
  },

  teamMemberRemoved: async (
    projectId: string,
    userId: string,
    userName: string,
    memberName: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'team',
        action: 'team_member_removed',
        description: `${userName} removed ${memberName} from the team`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          teamMemberName: memberName,
        },
      });
    } catch (error) {
      console.error('Activity log error (teamMemberRemoved):', error);
    }
  },

  // Document Activities
  documentUploaded: async (
    projectId: string,
    userId: string,
    userName: string,
    documentName: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'document',
        action: 'document_uploaded',
        description: `${userName} uploaded document "${documentName}"`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          documentName,
        },
      });
    } catch (error) {
      console.error('Activity log error (documentUploaded):', error);
    }
  },

  documentDeleted: async (
    projectId: string,
    userId: string,
    userName: string,
    documentName: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'document',
        action: 'document_deleted',
        description: `${userName} deleted document "${documentName}"`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          documentName,
        },
      });
    } catch (error) {
      console.error('Activity log error (documentDeleted):', error);
    }
  },

  // Approval Activities
  approvalRequested: async (
    projectId: string,
    userId: string,
    userName: string,
    approvalType: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'approval',
        action: 'approval_requested',
        description: `${userName} requested approval for ${approvalType}`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          approvalType,
        },
      });
    } catch (error) {
      console.error('Activity log error (approvalRequested):', error);
    }
  },

  approvalGranted: async (
    projectId: string,
    userId: string,
    userName: string,
    approvalType: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'approval',
        action: 'approval_granted',
        description: `${userName} approved ${approvalType}`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          approvalType,
        },
      });
    } catch (error) {
      console.error('Activity log error (approvalGranted):', error);
    }
  },

  approvalRejected: async (
    projectId: string,
    userId: string,
    userName: string,
    approvalType: string
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'approval',
        action: 'approval_rejected',
        description: `${userName} rejected ${approvalType}`,
        userId: new mongoose.Types.ObjectId(userId),
        userName,
        metadata: {
          approvalType,
          severity: 'warning',
        },
      });
    } catch (error) {
      console.error('Activity log error (approvalRejected):', error);
    }
  },

  // System Activities
  systemAlert: async (
    projectId: string,
    description: string,
    severity: 'info' | 'warning' | 'critical' = 'info'
  ) => {
    try {
      await ProjectActivity.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        type: 'system',
        action: 'system_alert',
        description,
        metadata: {
          severity,
        },
      });
    } catch (error) {
      console.error('Activity log error (systemAlert):', error);
    }
  },
};