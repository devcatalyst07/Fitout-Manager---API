import express, { Request, Response } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { authMiddleware } from '../middleware/auth'; // Changed from 'authenticate'
import Task from '../models/Task';
import Phase from '../models/Phase';
import ExcelJS from 'exceljs';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .xlsx and .xls files are allowed.'));
    }
  },
});

/**
 * POST /api/scopes/:scopeId/workflows/:workflowId/tasks/bulk-upload
 * Upload Excel file to bulk create template tasks for a workflow
 */
router.post(
  '/scopes/:scopeId/workflows/:workflowId/tasks/bulk-upload',
  authMiddleware, // Changed from 'authenticate'
  upload.single('file'),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { scopeId, workflowId } = req.params;

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      // Parse Excel file
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        return res.status(400).json({ message: 'Excel file is empty' });
      }

      // Validate required columns (NEW FORMAT)
      const requiredColumns = [
        'Task ID',
        'Phase Name',
        'Task Title',
        'Task Description',
        'Task Type',
        'Priority',
        'Predecessor IDs',
        'Dependency Type',
        'Lag (Days)',
        'Duration (Days)',
      ];

      const firstRow = jsonData[0];
      const actualColumns = Object.keys(firstRow);
      const missingColumns = requiredColumns.filter(
        (col) => !actualColumns.includes(col)
      );

      if (missingColumns.length > 0) {
        return res.status(400).json({
          message: `Missing required columns: ${missingColumns.join(', ')}. Please download the latest template.`,
        });
      }

      // Group tasks by phase
      const phaseMap = new Map<string, any[]>();
      const taskIdMap: Record<string, string> = {}; // Map template Task ID to created task _id

      for (const row of jsonData) {
        const phaseName = row['Phase Name'];
        if (!phaseName) continue;

        if (!phaseMap.has(phaseName)) {
          phaseMap.set(phaseName, []);
        }
        phaseMap.get(phaseName)!.push(row);
      }

      let phasesCreated = 0;
      let tasksCreated = 0;

      // First Pass: Create phases and tasks (without dependencies)
      for (const [phaseName, tasks] of phaseMap.entries()) {
        // Create phase
        const phase = await Phase.create({
          name: phaseName,
          description: `Phase for ${phaseName}`,
          order: phasesCreated,
          workflowId,
          scopeId,
          isTemplate: true,
        });

        phasesCreated++;

        // Create tasks for this phase
        for (const row of tasks) {
          const taskId = row['Task ID'];
          const taskTitle = row['Task Title'];
          const taskDescription = row['Task Description'] || '';
          const taskType = row['Task Type'] || 'Task';
          const priority = row['Priority'] || 'Medium';
          const duration = parseFloat(row['Duration (Days)']) || 1;

          // Validate task type
          if (!['Task', 'Deliverable', 'Milestone'].includes(taskType)) {
            console.warn(
              `Invalid task type "${taskType}" for task ${taskId}. Defaulting to "Task".`
            );
          }

          // Validate priority
          if (!['Low', 'Medium', 'High', 'Critical'].includes(priority)) {
            console.warn(
              `Invalid priority "${priority}" for task ${taskId}. Defaulting to "Medium".`
            );
          }

          // Validate milestone duration
          if (taskType === 'Milestone' && duration > 1) {
            return res.status(400).json({
              message: `Task ${taskId}: Milestone tasks can have a maximum duration of 1 day`,
            });
          }

          // Create task (without dependencies initially)
          const task = await Task.create({
            title: taskTitle,
            description: taskDescription,
            status: 'Backlog',
            priority: ['Low', 'Medium', 'High', 'Critical'].includes(priority)
              ? priority
              : 'Medium',
            taskType: ['Task', 'Deliverable', 'Milestone'].includes(taskType)
              ? taskType
              : 'Task',
            assignees: [],
            progress: 0,
            duration,
            dependencies: [], // Will be populated in second pass
            phaseId: phase._id,
            workflowId,
            scopeId,
            isTemplate: true,
          });

          // Map template Task ID to created task _id
          taskIdMap[taskId] = task._id.toString();
          tasksCreated++;
        }
      }

      // Second Pass: Update dependencies using taskIdMap
      for (const row of jsonData) {
        const taskId = row['Task ID'];
        const predecessorIds = row['Predecessor IDs'];
        const dependencyType = row['Dependency Type'];

        if (!taskId || !taskIdMap[taskId]) {
          continue;
        }

        const dependencies: { taskId: string; type: 'FS' | 'SS' }[] = [];

        if (predecessorIds) {
          const predIds = predecessorIds
            .toString()
            .split(';')
            .map((s: string) => s.trim())
            .filter(Boolean);
          const depTypes = dependencyType
            ? dependencyType
                .toString()
                .split(';')
                .map((s: string) => s.trim())
                .filter(Boolean)
            : [];

          predIds.forEach((predId: string, index: number) => {
            const type = depTypes[index] || 'FS'; // Default to FS if not specified
            if (!['FS', 'SS'].includes(type)) {
              console.warn(
                `Invalid dependency type "${type}" for task ${taskId}. Defaulting to FS.`
              );
            }
            dependencies.push({
              taskId: taskIdMap[predId],
              type: type === 'SS' ? 'SS' : 'FS',
            });
          });
        }

        // Update the task with dependencies
        await Task.findByIdAndUpdate(taskIdMap[taskId], {
          dependencies,
        });
      }

      res.status(201).json({
        message: 'Tasks uploaded successfully',
        phasesCreated,
        tasksCreated,
      });
    } catch (error: any) {
      console.error('Bulk upload error:', error);
      res.status(500).json({
        message: error.message || 'Failed to upload tasks',
      });
    }
  }
);

/**
 * GET /api/scopes/:scopeId/workflows/:workflowId/templates/task-upload-template.xlsx
 * Download Excel template for bulk task upload (NEW FORMAT)
 */
router.get(
  '/scopes/:scopeId/workflows/:workflowId/templates/task-upload-template.xlsx',
  authMiddleware, // Changed from 'authenticate'
  async (req: Request, res: Response): Promise<any> => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Tasks');

      // Define columns (NEW FORMAT)
      worksheet.columns = [
        { header: 'Task ID', key: 'taskId', width: 12 },
        { header: 'Phase Name', key: 'phaseName', width: 20 },
        { header: 'Task Title', key: 'taskTitle', width: 40 },
        { header: 'Task Description', key: 'taskDescription', width: 50 },
        { header: 'Task Type', key: 'taskType', width: 15 },
        { header: 'Priority', key: 'priority', width: 12 },
        { header: 'Predecessor IDs', key: 'predecessorIds', width: 20 },
        { header: 'Dependency Type', key: 'dependencyType', width: 18 },
        { header: 'Lag (Days)', key: 'lagDays', width: 12 },
        { header: 'Duration (Days)', key: 'duration', width: 15 },
      ];

      // Style header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 20;

      // Add sample data with dependencies
      const sampleData = [
        // Planning Phase
        {
          taskId: 'W001',
          phaseName: 'Planning',
          taskTitle: 'Initial Site Survey',
          taskDescription: 'Conduct comprehensive site assessment and measurements',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: '',
          dependencyType: '',
          lagDays: 0,
          duration: 8,
        },
        {
          taskId: 'W002',
          phaseName: 'Planning',
          taskTitle: 'Feasibility Study',
          taskDescription: 'Analyze project feasibility including costs and timeline',
          taskType: 'Deliverable',
          priority: 'High',
          predecessorIds: 'W001',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 16,
        },
        {
          taskId: 'W003',
          phaseName: 'Planning',
          taskTitle: 'Budget Approval',
          taskDescription: 'Obtain budget approval from stakeholders',
          taskType: 'Milestone',
          priority: 'Critical',
          predecessorIds: 'W002',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 1,
        },

        // Design Phase
        {
          taskId: 'W004',
          phaseName: 'Design',
          taskTitle: 'Schematic Design',
          taskDescription: 'Create initial design concepts and layouts',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W003',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 20,
        },
        {
          taskId: 'W005',
          phaseName: 'Design',
          taskTitle: 'Design Development',
          taskDescription: 'Develop detailed design specifications',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W004',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 20,
        },
        {
          taskId: 'W006',
          phaseName: 'Design',
          taskTitle: 'Construction Documents',
          taskDescription: 'Prepare detailed construction drawings and specifications',
          taskType: 'Deliverable',
          priority: 'High',
          predecessorIds: 'W005',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 24,
        },
        {
          taskId: 'W007',
          phaseName: 'Design',
          taskTitle: 'Design Approval',
          taskDescription: 'Obtain final design approval from client',
          taskType: 'Milestone',
          priority: 'Critical',
          predecessorIds: 'W006',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 1,
        },

        // Procurement Phase
        {
          taskId: 'W008',
          phaseName: 'Procurement',
          taskTitle: 'Prepare Tender Documents',
          taskDescription: 'Compile specifications and drawings for tender',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W007',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 8,
        },
        {
          taskId: 'W009',
          phaseName: 'Procurement',
          taskTitle: 'Vendor Selection',
          taskDescription: 'Review bids and select contractors',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W006;W007',
          dependencyType: 'FS;FS',
          lagDays: 0,
          duration: 12,
        },
        {
          taskId: 'W010',
          phaseName: 'Procurement',
          taskTitle: 'Contract Award',
          taskDescription: 'Finalize and award construction contracts',
          taskType: 'Milestone',
          priority: 'Critical',
          predecessorIds: 'W009',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 1,
        },

        // Construction Phase
        {
          taskId: 'W011',
          phaseName: 'Construction',
          taskTitle: 'Site Mobilization',
          taskDescription: 'Set up site facilities and prepare for construction',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W010',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 8,
        },
        {
          taskId: 'W012',
          phaseName: 'Construction',
          taskTitle: 'Demolition Works',
          taskDescription: 'Remove existing fixtures and prepare space',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W011',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 10,
        },
        {
          taskId: 'W013',
          phaseName: 'Construction',
          taskTitle: 'MEP Rough-in',
          taskDescription: 'Install mechanical, electrical, and plumbing systems',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W012',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 20,
        },
        {
          taskId: 'W014',
          phaseName: 'Construction',
          taskTitle: 'Partition Walls',
          taskDescription: 'Construct partition walls and framing',
          taskType: 'Task',
          priority: 'Medium',
          predecessorIds: 'W012',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 15,
        },
        {
          taskId: 'W015',
          phaseName: 'Construction',
          taskTitle: 'Ceiling Installation',
          taskDescription: 'Install suspended ceiling systems',
          taskType: 'Task',
          priority: 'Medium',
          predecessorIds: 'W013;W014',
          dependencyType: 'FS;FS',
          lagDays: 0,
          duration: 12,
        },
        {
          taskId: 'W016',
          phaseName: 'Construction',
          taskTitle: 'Flooring Installation',
          taskDescription: 'Install floor finishes',
          taskType: 'Task',
          priority: 'Medium',
          predecessorIds: 'W013',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 10,
        },
        {
          taskId: 'W017',
          phaseName: 'Construction',
          taskTitle: 'Interior Finishes',
          taskDescription: 'Paint and install final finishes',
          taskType: 'Task',
          priority: 'Medium',
          predecessorIds: 'W015;W016',
          dependencyType: 'FS;FS',
          lagDays: 0,
          duration: 15,
        },

        // Handover Phase
        {
          taskId: 'W018',
          phaseName: 'Handover',
          taskTitle: 'MEP Testing & Commissioning',
          taskDescription: 'Test all mechanical, electrical, and plumbing systems',
          taskType: 'Task',
          priority: 'Critical',
          predecessorIds: 'W017',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 8,
        },
        {
          taskId: 'W019',
          phaseName: 'Handover',
          taskTitle: 'Defects Inspection',
          taskDescription: 'Conduct thorough inspection and create snag list',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W018',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 5,
        },
        {
          taskId: 'W020',
          phaseName: 'Handover',
          taskTitle: 'Rectification Works',
          taskDescription: 'Complete all defect rectifications',
          taskType: 'Task',
          priority: 'High',
          predecessorIds: 'W019',
          dependencyType: 'FS',
          lagDays: 0,
          duration: 10,
        },
        {
          taskId: 'W021',
          phaseName: 'Handover',
          taskTitle: 'Final Documentation',
          taskDescription: 'Prepare as-built drawings and O&M manuals',
          taskType: 'Deliverable',
          priority: 'High',
          predecessorIds: 'W018',
          dependencyType: 'SS',
          lagDays: 0,
          duration: 8,
        },
        {
          taskId: 'W022',
          phaseName: 'Handover',
          taskTitle: 'Project Handover',
          taskDescription: 'Official handover to client',
          taskType: 'Milestone',
          priority: 'Critical',
          predecessorIds: 'W020;W021',
          dependencyType: 'FS;FS',
          lagDays: 0,
          duration: 1,
        },
      ];

      // Add data rows
      sampleData.forEach((data) => {
        const row = worksheet.addRow(data);
        row.alignment = { vertical: 'middle', wrapText: true };

        // Color code by task type
        if (data.taskType === 'Milestone') {
          row.getCell('taskType').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD4EDDA' },
          };
        } else if (data.taskType === 'Deliverable') {
          row.getCell('taskType').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFCFE2FF' },
          };
        }
      });

      // Add instructions sheet
      const instructionsSheet = workbook.addWorksheet('Instructions');
      instructionsSheet.columns = [
        { header: 'Column', key: 'column', width: 20 },
        { header: 'Description', key: 'description', width: 60 },
        { header: 'Valid Values', key: 'validValues', width: 30 },
      ];

      const instructions = [
        {
          column: 'Task ID',
          description: 'Unique identifier for the task (e.g., W001, W002). Used for referencing in dependencies.',
          validValues: 'Any unique alphanumeric string',
        },
        {
          column: 'Phase Name',
          description: 'Name of the project phase this task belongs to.',
          validValues: 'Any text (e.g., Planning, Design, Construction)',
        },
        {
          column: 'Task Title',
          description: 'Short, descriptive title for the task.',
          validValues: 'Any text',
        },
        {
          column: 'Task Description',
          description: 'Detailed description of what the task involves.',
          validValues: 'Any text',
        },
        {
          column: 'Task Type',
          description: 'Type of task. Task=regular work, Deliverable=produces output, Milestone=key checkpoint (max 1 day).',
          validValues: 'Task, Deliverable, Milestone',
        },
        {
          column: 'Priority',
          description: 'Importance level of the task.',
          validValues: 'Low, Medium, High, Critical',
        },
        {
          column: 'Predecessor IDs',
          description: 'Task IDs that must be completed before this task can start. Separate multiple IDs with semicolons.',
          validValues: 'Task IDs separated by ; (e.g., W001;W002)',
        },
        {
          column: 'Dependency Type',
          description: 'Type of dependency relationship. FS=Finish-to-Start, SS=Start-to-Start. Must match number of predecessor IDs.',
          validValues: 'FS, SS (separated by ; if multiple)',
        },
        {
          column: 'Lag (Days)',
          description: 'Number of days delay between predecessor completion and this task start. (Not yet implemented)',
          validValues: 'Number (currently ignored)',
        },
        {
          column: 'Duration (Days)',
          description: 'Number of working days required to complete the task (Monday-Friday, excludes weekends).',
          validValues: 'Positive number (Milestones max 1)',
        },
      ];

      instructionsSheet.getRow(1).font = { bold: true };
      instructionsSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
      };

      instructions.forEach((instruction) => {
        const row = instructionsSheet.addRow(instruction);
        row.alignment = { vertical: 'top', wrapText: true };
      });

      // Add notes
      instructionsSheet.addRow([]);
      instructionsSheet.addRow(['IMPORTANT NOTES:', '', '']);
      instructionsSheet.getCell('A' + instructionsSheet.rowCount).font = { bold: true, size: 12 };
      
      instructionsSheet.addRow(['• Task IDs must be unique within the workflow', '', '']);
      instructionsSheet.addRow(['• Predecessor IDs must reference valid Task IDs in the same file', '', '']);
      instructionsSheet.addRow(['• Milestone tasks can have a maximum duration of 1 day', '', '']);
      instructionsSheet.addRow(['• Dependencies can reference tasks in different phases', '', '']);
      instructionsSheet.addRow(['• FS (Finish-Start): Task starts after predecessor finishes', '', '']);
      instructionsSheet.addRow(['• SS (Start-Start): Task starts when predecessor starts', '', '']);
      instructionsSheet.addRow(['• Duration is in working days (Monday-Friday, excludes weekends)', '', '']);

      // Set response headers
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=task-upload-template.xlsx'
      );

      // Write to response
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error('Template download error:', error);
      res.status(500).json({
        message: error.message || 'Failed to generate template',
      });
    }
  }
);

export default router;