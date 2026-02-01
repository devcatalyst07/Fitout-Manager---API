import Phase from '../models/Phase';
import Task from '../models/Task';
import Workflow from '../models/Workflow';
import Scope from '../models/Scope';
import mongoose from 'mongoose';

/**
 * Copy all template phases and tasks from a workflow to a project
 * This creates actual project phases and tasks based on the template
 */
export const copyWorkflowTemplatesToProject = async (
  projectId: mongoose.Types.ObjectId | string,
  scopeName: string,
  workflowName: string,
  userId: mongoose.Types.ObjectId | string
): Promise<{ phasesCreated: number; tasksCreated: number }> => {
  try {
    // Find the scope
    const scope = await Scope.findOne({ name: scopeName, isActive: true });
    if (!scope) {
      console.log(`Scope "${scopeName}" not found`);
      return { phasesCreated: 0, tasksCreated: 0 };
    }

    // Find the workflow
    const workflow = await Workflow.findOne({
      name: workflowName,
      scopeId: scope._id,
      isActive: true,
    });

    if (!workflow) {
      console.log(`Workflow "${workflowName}" not found in scope "${scopeName}"`);
      return { phasesCreated: 0, tasksCreated: 0 };
    }

    // Find all template phases for this workflow
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

    // For each template phase, create a project phase and copy its tasks
    for (const templatePhase of templatePhases) {
      // Create project phase (copy of template)
      const projectPhase = await Phase.create({
        name: templatePhase.name,
        description: templatePhase.description,
        workflowId: templatePhase.workflowId,
        scopeId: templatePhase.scopeId,
        order: templatePhase.order,
        color: templatePhase.color,
        isTemplate: false, // This is a project phase, not a template
        projectId: projectId,
        createdBy: userId,
      });

      // Find all template tasks for this phase
      const templateTasks = await Task.find({
        phaseId: templatePhase._id,
        isTemplate: true,
      }).sort({ order: 1 });

      // Create project tasks (copies of templates)
      for (const templateTask of templateTasks) {
        await Task.create({
          title: templateTask.title,
          description: templateTask.description,
          status: 'Backlog', // New tasks start in Backlog
          priority: templateTask.priority,
          assignees: [], // No assignees yet
          progress: 0,
          estimateHours: templateTask.estimateHours,
          projectId: projectId,
          phaseId: projectPhase._id, // Link to the newly created project phase
          isTemplate: false, // This is a project task, not a template
          order: templateTask.order,
          createdBy: userId,
        });

        totalTasksCreated++;
      }
    }

    console.log(
      `✅ Copied ${templatePhases.length} phases and ${totalTasksCreated} tasks to project ${projectId}`
    );

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
    // Delete all project tasks
    await Task.deleteMany({ projectId, isTemplate: false });

    // Delete all project phases
    await Phase.deleteMany({ projectId, isTemplate: false });

    console.log(`✅ Deleted all phases and tasks for project ${projectId}`);
  } catch (error) {
    console.error('Error deleting project phases and tasks:', error);
    throw error;
  }
};