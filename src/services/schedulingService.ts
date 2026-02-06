import Task from '../models/Task';
import Project from '../models/Projects';
import mongoose from 'mongoose';

interface ScheduleTask {
  _id: string;
  duration: number;
  dependencies: { taskId: string; type: 'FS' | 'SS' }[];
  startDate?: Date;
  dueDate?: Date;
}

/**
 * Add working days to a date (Monday-Friday only, no holidays)
 */
function addWorkingDays(startDate: Date, days: number): Date {
  const result = new Date(startDate);
  let addedDays = 0;
  
  while (addedDays < days) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      addedDays++;
    }
  }
  
  return result;
}

/**
 * Subtract working days from a date (Monday-Friday only, no holidays)
 */
function subtractWorkingDays(endDate: Date, days: number): Date {
  const result = new Date(endDate);
  let subtractedDays = 0;
  
  while (subtractedDays < days) {
    result.setDate(result.getDate() - 1);
    const dayOfWeek = result.getDay();
    
    // Skip weekends
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      subtractedDays++;
    }
  }
  
  return result;
}

/**
 * Calculate forward schedule (from start date)
 */
function calculateForwardSchedule(
  tasks: ScheduleTask[],
  projectStartDate: Date
): Map<string, { startDate: Date; endDate: Date }> {
  const schedule = new Map<string, { startDate: Date; endDate: Date }>();
  const taskMap = new Map(tasks.map(t => [t._id.toString(), t]));
  
  // Topological sort to process tasks in dependency order
  const processed = new Set<string>();
  const processing = new Set<string>();
  
  function processTask(taskId: string): void {
    if (processed.has(taskId)) return;
    if (processing.has(taskId)) {
      throw new Error('Circular dependency detected');
    }
    
    processing.add(taskId);
    const task = taskMap.get(taskId);
    if (!task) return;
    
    // Process dependencies first
    for (const dep of task.dependencies) {
      processTask(dep.taskId);
    }
    
    // Calculate this task's dates
    let taskStartDate = new Date(projectStartDate);
    
    // Find latest constraint from dependencies
    for (const dep of task.dependencies) {
      const depSchedule = schedule.get(dep.taskId);
      if (depSchedule) {
        let constraintDate: Date;
        
        if (dep.type === 'FS') {
          // Finish-Start: this task starts after dependency finishes
          constraintDate = new Date(depSchedule.endDate);
          constraintDate.setDate(constraintDate.getDate() + 1);
        } else {
          // Start-Start: this task starts when dependency starts
          constraintDate = new Date(depSchedule.startDate);
        }
        
        if (constraintDate > taskStartDate) {
          taskStartDate = constraintDate;
        }
      }
    }
    
    // Ensure start date is a working day
    while (taskStartDate.getDay() === 0 || taskStartDate.getDay() === 6) {
      taskStartDate.setDate(taskStartDate.getDate() + 1);
    }
    
    const taskEndDate = addWorkingDays(taskStartDate, Math.max(task.duration - 1, 0));
    
    schedule.set(taskId, {
      startDate: taskStartDate,
      endDate: taskEndDate,
    });
    
    processing.delete(taskId);
    processed.add(taskId);
  }
  
  // Process all tasks
  for (const task of tasks) {
    processTask(task._id.toString());
  }
  
  return schedule;
}

/**
 * Calculate backward schedule (from end date)
 */
function calculateBackwardSchedule(
  tasks: ScheduleTask[],
  projectEndDate: Date
): Map<string, { startDate: Date; endDate: Date }> {
  const schedule = new Map<string, { startDate: Date; endDate: Date }>();
  const taskMap = new Map(tasks.map(t => [t._id.toString(), t]));
  
  // Build reverse dependency map
  const reverseDeps = new Map<string, { taskId: string; type: 'FS' | 'SS' }[]>();
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!reverseDeps.has(dep.taskId)) {
        reverseDeps.set(dep.taskId, []);
      }
      reverseDeps.get(dep.taskId)!.push({
        taskId: task._id.toString(),
        type: dep.type,
      });
    }
  }
  
  const processed = new Set<string>();
  const processing = new Set<string>();
  
  function processTask(taskId: string): void {
    if (processed.has(taskId)) return;
    if (processing.has(taskId)) {
      throw new Error('Circular dependency detected');
    }
    
    processing.add(taskId);
    const task = taskMap.get(taskId);
    if (!task) return;
    
    // Process reverse dependencies first
    const revDeps = reverseDeps.get(taskId) || [];
    for (const dep of revDeps) {
      processTask(dep.taskId);
    }
    
    // Calculate this task's dates
    let taskEndDate = new Date(projectEndDate);
    
    // Find earliest constraint from reverse dependencies
    for (const dep of revDeps) {
      const depSchedule = schedule.get(dep.taskId);
      if (depSchedule) {
        let constraintDate: Date;
        
        if (dep.type === 'FS') {
          // This task must finish before successor starts
          constraintDate = new Date(depSchedule.startDate);
          constraintDate.setDate(constraintDate.getDate() - 1);
        } else {
          // This task must start when successor starts
          constraintDate = new Date(depSchedule.startDate);
        }
        
        if (constraintDate < taskEndDate) {
          taskEndDate = constraintDate;
        }
      }
    }
    
    // Ensure end date is a working day
    while (taskEndDate.getDay() === 0 || taskEndDate.getDay() === 6) {
      taskEndDate.setDate(taskEndDate.getDate() - 1);
    }
    
    const taskStartDate = subtractWorkingDays(taskEndDate, Math.max(task.duration - 1, 0));
    
    schedule.set(taskId, {
      startDate: taskStartDate,
      endDate: taskEndDate,
    });
    
    processing.delete(taskId);
    processed.add(taskId);
  }
  
  // Process all tasks
  for (const task of tasks) {
    processTask(task._id.toString());
  }
  
  return schedule;
}

/**
 * Calculate project schedule based on tasks and dependencies
 */
export async function calculateProjectSchedule(
  projectId: mongoose.Types.ObjectId | string,
  anchorDate: Date,
  scheduleFrom: 'start' | 'end'
): Promise<{
  taskSchedules: Map<string, { startDate: Date; endDate: Date }>;
  projectStart: Date;
  projectEnd: Date;
  isAtRisk: boolean;
  riskReason?: string;
}> {
  try {
    const tasks = await Task.find({
      projectId,
      isTemplate: false,
    }).lean();

    if (tasks.length === 0) {
      return {
        taskSchedules: new Map(),
        projectStart: anchorDate,
        projectEnd: anchorDate,
        isAtRisk: false,
      };
    }

    const scheduleTasks: ScheduleTask[] = tasks.map((t: any) => ({
      _id: t._id.toString(),
      duration: t.duration || 1,
      dependencies: t.dependencies || [],
      startDate: t.startDate,
      dueDate: t.dueDate,
    }));

    let schedule: Map<string, { startDate: Date; endDate: Date }>;
    let isAtRisk = false;
    let riskReason: string | undefined;

    if (scheduleFrom === 'start') {
      schedule = calculateForwardSchedule(scheduleTasks, anchorDate);
    } else {
      schedule = calculateBackwardSchedule(scheduleTasks, anchorDate);
    }

    // Find project bounds
    let projectStart = anchorDate;
    let projectEnd = anchorDate;

    for (const dates of schedule.values()) {
      if (dates.startDate < projectStart) projectStart = dates.startDate;
      if (dates.endDate > projectEnd) projectEnd = dates.endDate;
    }

    // Check if at risk
    if (scheduleFrom === 'end') {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      if (projectStart < now) {
        isAtRisk = true;
        riskReason = 'Required start date is in the past';
      }
    } else {
      // Schedule from start - check if end date matches anchor if provided
      const project = await Project.findById(projectId);
      if (project?.endDate) {
        const providedEnd = new Date(project.endDate);
        providedEnd.setHours(0, 0, 0, 0);
        
        if (projectEnd > providedEnd) {
          isAtRisk = true;
          riskReason = 'Programme duration exceeds available time';
        }
      }
    }

    return {
      taskSchedules: schedule,
      projectStart,
      projectEnd,
      isAtRisk,
      riskReason,
    };
  } catch (error) {
    console.error('Schedule calculation error:', error);
    throw error;
  }
}

export default {
  calculateProjectSchedule,
  addWorkingDays,
  subtractWorkingDays,
};