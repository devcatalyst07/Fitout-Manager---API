import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import multer from "multer";
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import Phase from "../models/Phase";
import Task from "../models/Task";
import mongoose from "mongoose";

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    
    if (allowedTypes.includes(file.mimetype) || 
        file.originalname.match(/\.(xlsx|xls|csv)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV files are allowed'));
    }
  }
});

// ==================== PARSE EXCEL FILE ====================
router.post(
  "/:scopeId/workflows/:workflowId/parse-excel",
  authMiddleware,
  requirePermission("projects-task-create"),
  upload.single('file'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { scopeId, workflowId } = req.params;

      // Parse the Excel file
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      
      // Use first sheet
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON with header row
      const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        defval: '',
        blankrows: false
      });

      if (jsonData.length < 2) {
        return res.status(400).json({ 
          message: "File must contain at least a header row and one data row" 
        });
      }

      // Parse the data into phases and tasks
      const result = parseExcelData(jsonData);

      res.json(result);
    } catch (error: any) {
      console.error("Parse Excel error:", error);
      res.status(500).json({ 
        message: "Failed to parse Excel file", 
        error: error.message 
      });
    }
  }
);

// ==================== BULK CREATE PHASES AND TASKS ====================
router.post(
  "/:scopeId/workflows/:workflowId/bulk-create",
  authMiddleware,
  requirePermission("projects-task-create"),
  async (req: AuthRequest, res) => {
    try {
      const { scopeId, workflowId } = req.params;
      const { phases } = req.body;

      if (!phases || !Array.isArray(phases) || phases.length === 0) {
        return res.status(400).json({ message: "No phases provided" });
      }

      const createdPhases = [];

      // Create phases and tasks
      for (const phaseData of phases) {
        // Create phase
        const phase = await Phase.create({
          name: phaseData.name,
          description: phaseData.description || '',
          workflowId,
          scopeId, // Use actual scopeId from request params
          order: phaseData.order,
          isTemplate: true,
          createdBy: req.user.id,
        });

        // Create tasks for this phase
        const createdTasks = [];
        for (const taskData of phaseData.tasks) {
          const task = await Task.create({
            title: taskData.title,
            description: taskData.description || '',
            priority: taskData.priority || 'Medium',
            estimateHours: taskData.estimateHours,
            order: taskData.order,
            phaseId: phase._id,
            workflowId,
            scopeId, // Use actual scopeId from request params
            isTemplate: true,
            status: 'Backlog',
            assignees: [], // No assignees for template tasks
            progress: 0,
            createdBy: req.user.id,
          });
          createdTasks.push(task);
        }

        createdPhases.push({
          ...phase.toObject(),
          tasks: createdTasks,
        });
      }

      res.status(201).json({
        message: `Successfully created ${createdPhases.length} phases with ${
          createdPhases.reduce((sum, p) => sum + p.tasks.length, 0)
        } tasks`,
        phases: createdPhases,
      });
    } catch (error: any) {
      console.error("Bulk create error:", error);
      res.status(500).json({ 
        message: "Failed to create phases and tasks", 
        error: error.message 
      });
    }
  }
);

// ==================== DOWNLOAD TEMPLATE ====================
router.get("/templates/task-upload-template.xlsx", (req, res) => {
  // Generate template file
  const templateData = [
    ['Phase Name', 'Task Title', 'Task Description', 'Priority', 'Estimate Hours'],
    ['Planning', 'Initial site survey', 'Conduct comprehensive site survey and documentation', 'High', 8],
    ['Planning', 'Feasibility study', 'Analyze technical and financial feasibility', 'High', 16],
    ['Planning', 'Create project timeline', 'Develop detailed project schedule with milestones', 'Medium', 4],
    ['', '', '', '', ''],
    ['Design', 'Conceptual design', 'Create initial design concepts and mood boards', 'High', 24],
    ['Design', 'Technical drawings', 'Prepare detailed technical and construction drawings', 'Critical', 40],
    ['Design', 'Material selection', 'Select and specify all materials and finishes', 'Medium', 16],
    ['', '', '', '', ''],
    ['Procurement', 'Vendor selection', 'Research and select qualified vendors', 'High', 12],
    ['Procurement', 'Purchase orders', 'Create and process all purchase orders', 'Medium', 8],
    ['Procurement', 'Material tracking', 'Track delivery schedules and material arrival', 'Low', 4],
    ['', '', '', '', ''],
    ['Construction', 'Site preparation', 'Prepare site for construction work', 'High', 16],
    ['Construction', 'Structural work', 'Complete all structural modifications', 'Critical', 80],
    ['Construction', 'MEP installation', 'Install mechanical, electrical, and plumbing systems', 'Critical', 120],
    ['Construction', 'Finishes installation', 'Install all finishes, fixtures, and fittings', 'High', 60],
    ['Construction', 'Quality inspection', 'Conduct quality checks and punch list items', 'High', 16],
  ];

  const ws = XLSX.utils.aoa_to_sheet(templateData);
  
  // Set column widths
  ws['!cols'] = [
    { wch: 20 }, // Phase Name
    { wch: 30 }, // Task Title
    { wch: 50 }, // Task Description
    { wch: 12 }, // Priority
    { wch: 15 }, // Estimate Hours
  ];

  // Merge cells for phase names (rows with same phase)
  const merges = [];
  let currentPhase = '';
  let startRow = 1;

  for (let i = 1; i < templateData.length; i++) {
    const phaseName = templateData[i][0];
    
    if (phaseName && phaseName !== currentPhase) {
      if (currentPhase && i > startRow + 1) {
        merges.push({ s: { r: startRow, c: 0 }, e: { r: i - 1, c: 0 } });
      }
      currentPhase = phaseName.toString();
      startRow = i;
    }
  }
  
  ws['!merges'] = merges;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tasks Template');

  // Write to buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=task-upload-template.xlsx');
  res.send(buffer);
});

// ==================== HELPER FUNCTIONS ====================

interface ParsedPhase {
  name: string;
  description?: string;
  order: number;
  tasks: ParsedTask[];
}

interface ParsedTask {
  title: string;
  description?: string;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  estimateHours?: number;
  order: number;
}

interface ParseResult {
  phases: ParsedPhase[];
  errors: string[];
  warnings: string[];
}

function parseExcelData(data: any[][]): ParseResult {
  const phases: ParsedPhase[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Skip header row
  let currentPhase: ParsedPhase | null = null;
  let phaseOrder = 0;
  let taskOrder = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 1;

    // Skip empty rows
    if (!row || row.every(cell => !cell || cell.toString().trim() === '')) {
      continue;
    }

    const [phaseName, taskTitle, taskDesc, priority, estimateHours] = row;

    // Check if this is a new phase
    if (phaseName && phaseName.toString().trim()) {
      // Save previous phase if exists
      if (currentPhase && currentPhase.tasks.length > 0) {
        phases.push(currentPhase);
      }

      // Start new phase
      currentPhase = {
        name: phaseName.toString().trim(),
        order: phaseOrder++,
        tasks: [],
      };
      taskOrder = 0;
    }

    // Validate task title
    if (!taskTitle || !taskTitle.toString().trim()) {
      errors.push(`Row ${rowNum}: Task title is required`);
      continue;
    }

    if (!currentPhase) {
      errors.push(`Row ${rowNum}: Task must belong to a phase`);
      continue;
    }

    // Validate priority
    const validPriorities = ['Low', 'Medium', 'High', 'Critical'];
    let taskPriority: 'Low' | 'Medium' | 'High' | 'Critical' = 'Medium';
    
    if (priority && priority.toString().trim()) {
      const priorityStr = priority.toString().trim();
      const matchedPriority = validPriorities.find(
        p => p.toLowerCase() === priorityStr.toLowerCase()
      );
      
      if (matchedPriority) {
        taskPriority = matchedPriority as 'Low' | 'Medium' | 'High' | 'Critical';
      } else {
        warnings.push(
          `Row ${rowNum}: Invalid priority "${priorityStr}", defaulting to Medium`
        );
      }
    }

    // Parse estimate hours
    let hours: number | undefined;
    if (estimateHours) {
      const parsed = parseFloat(estimateHours.toString());
      if (!isNaN(parsed) && parsed >= 0) {
        hours = parsed;
      } else {
        warnings.push(
          `Row ${rowNum}: Invalid estimate hours "${estimateHours}", ignoring`
        );
      }
    }

    // Add task to current phase
    currentPhase.tasks.push({
      title: taskTitle.toString().trim(),
      description: taskDesc ? taskDesc.toString().trim() : undefined,
      priority: taskPriority,
      estimateHours: hours,
      order: taskOrder++,
    });
  }

  // Add the last phase
  if (currentPhase && currentPhase.tasks.length > 0) {
    phases.push(currentPhase);
  }

  // Validation
  if (phases.length === 0) {
    errors.push('No valid phases found in the file');
  }

  return { phases, errors, warnings };
}

export default router;