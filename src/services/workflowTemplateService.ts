import Phase from '../models/Phase';
import Task from '../models/Task';
import Workflow from '../models/Workflow';
import Scope from '../models/Scope';
import Project from '../models/Projects';
import mongoose from 'mongoose';
import { calculateProjectSchedule } from './schedulingService';

/**
 * Copy all template phases and tasks from a workflow to a project with proper scheduling
 */
export const copyWorkflowTemplatesToProject = async (
  projectId: mongoose.Types.ObjectId | string,
  scopeName: string,
  workflowName: string,
  userId: mongoose.Types.ObjectId | string,
  scheduleAnchor: { date: Date; from: 'start' | 'end' }
): Promise<{ phasesCreated: number; tasksCreated: number }> => {
  try {
    const scope = await Scope.findOne({ name: scopeName, isActive: true });
    if (!scope) {
      console.log(`Scope "${scopeName}" not found`);
      return { phasesCreated: 0, tasksCreated: 0 };
    }

    const workflow = await Workflow.findOne({
      name: workflowName,
      scopeId: scope._id,
      isActive: true,
    });

    if (!workflow) {
      console.log(`Workflow "${workflowName}" not found in scope "${scopeName}"`);
      return { phasesCreated: 0, tasksCreated: 0 };
    }

    const templatePhases = await Phase.find({
      workflowId: workflow._id,
      scopeId: scope._id,
      isTemplate: true,
    }).sort({ order: 1 });

    if (templatePhases.length === 0) {
      console.log(`No template phases found for workflow "${workflowName}"`);
      return { phasesCreated: 0, tasksCreated: 0 };
    }

    let totalTasksCreated = 0;
    const templateToProjectTaskMap = new Map<string, string>();

    // Create phases and tasks
    for (const templatePhase of templatePhases) {
      const projectPhase = await Phase.create({
        name: templatePhase.name,
        description: templatePhase.description,
        workflowId: templatePhase.workflowId,
        scopeId: templatePhase.scopeId,
        order: templatePhase.order,
        color: templatePhase.color,
        isTemplate: false,
        projectId: projectId,
        createdBy: userId,
      });

      const templateTasks = await Task.find({
        phaseId: templatePhase._id,
        isTemplate: true,
      }).sort({ order: 1 });

      for (const templateTask of templateTasks) {
        const projectTask = await Task.create({
          title: templateTask.title,
          description: templateTask.description,
          status: 'Backlog',
          priority: templateTask.priority,
          assignees: [],
          progress: 0,
          estimateHours: templateTask.estimateHours,
          duration: templateTask.duration || 1, // CRITICAL: Copy duration
          taskType: templateTask.taskType || 'Task', // CRITICAL: Copy task type
          dependencies: [], // Will be mapped after all tasks are created
          projectId: projectId,
          phaseId: projectPhase._id,
          isTemplate: false,
          order: templateTask.order,
          createdBy: userId,
        });

        templateToProjectTaskMap.set(
          templateTask._id.toString(),
          projectTask._id.toString()
        );
        totalTasksCreated++;
      }
    }

    // Map dependencies from template tasks to project tasks
    const allTemplateTasks = await Task.find({
      workflowId: workflow._id,
      scopeId: scope._id,
      isTemplate: true,
    });

    for (const templateTask of allTemplateTasks) {
      if (templateTask.dependencies && templateTask.dependencies.length > 0) {
        const projectTaskId = templateToProjectTaskMap.get(templateTask._id.toString());
        
        if (projectTaskId) {
          const mappedDependencies = templateTask.dependencies
            .map(dep => {
              const depProjectTaskId = templateToProjectTaskMap.get(dep.taskId);
              if (depProjectTaskId) {
                return {
                  taskId: depProjectTaskId,
                  type: dep.type,
                };
              }
              return null;
            })
            .filter(Boolean);

          if (mappedDependencies.length > 0) {
            await Task.findByIdAndUpdate(projectTaskId, {
              $set: { dependencies: mappedDependencies },
            });
          }
        }
      }
    }

    // Calculate schedule based on anchor
    const scheduleResult = await calculateProjectSchedule(
      projectId,
      scheduleAnchor.date,
      scheduleAnchor.from
    );

    // Update project tasks with calculated dates
    for (const [taskId, dates] of scheduleResult.taskSchedules.entries()) {
      await Task.findByIdAndUpdate(taskId, {
        $set: {
          startDate: dates.startDate,
          dueDate: dates.endDate,
        },
      });
    }

    // Update project with calculated dates and risk status
    await Project.findByIdAndUpdate(projectId, {
      $set: {
        calculatedStartDate: scheduleResult.projectStart,
        calculatedEndDate: scheduleResult.projectEnd,
        isAtRisk: scheduleResult.isAtRisk,
        riskReason: scheduleResult.riskReason,
      },
    });

    console.log(
      `✅ Copied ${templatePhases.length} phases and ${totalTasksCreated} tasks to project ${projectId}`
    );
    console.log(
      `📅 Calculated schedule: ${scheduleResult.projectStart.toISOString()} to ${scheduleResult.projectEnd.toISOString()}`
    );
    if (scheduleResult.isAtRisk) {
      console.log(`⚠️ Project at risk: ${scheduleResult.riskReason}`);
    }

    return {
      phasesCreated: templatePhases.length,
      tasksCreated: totalTasksCreated,
    };
  } catch (error) {
    console.error('Error copying workflow templates to project:', error);
    throw error;
  }
};

/**
 * Get all phases and tasks for a project (non-template only)
 */
export const getProjectPhasesAndTasks = async (projectId: string) => {
  try {
    const phases = await Phase.find({
      projectId,
      isTemplate: false,
    }).sort({ order: 1 });

    const phasesWithTasks = await Promise.all(
      phases.map(async (phase) => {
        const tasks = await Task.find({
          projectId,
          phaseId: phase._id,
          isTemplate: false,
        }).sort({ order: 1 });

        return {
          ...phase.toObject(),
          tasks,
        };
      })
    );

    return phasesWithTasks;
  } catch (error) {
    console.error('Error getting project phases and tasks:', error);
    throw error;
  }
};

/**
 * Delete all phases and tasks for a project
 */
export const deleteProjectPhasesAndTasks = async (projectId: string) => {
  try {
    await Task.deleteMany({ projectId, isTemplate: false });
    await Phase.deleteMany({ projectId, isTemplate: false });
    console.log(`✅ Deleted all phases and tasks for project ${projectId}`);
  } catch (error) {
    console.error('Error deleting project phases and tasks:', error);
    throw error;
  }
};