import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Document from '../models/Document';
import Project from '../models/Projects';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/documents';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // More comprehensive MIME type checking
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'image/jpg'
    ];

    const allowedExtensions = /pdf|doc|docx|xlsx|xls|png|jpg|jpeg/;
    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    const mimetypeAllowed = allowedMimeTypes.includes(file.mimetype);

    if (extname && mimetypeAllowed) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG files are allowed'));
    }
  },
});

// GET all projects for dropdown (Admin only)
router.get('/projects', authMiddleware, adminOnly, async (req, res) => {
  try {
    const projects = await Project.find()
      .select('_id projectName')
      .sort({ projectName: 1 });

    res.json(projects);
  } catch (error: any) {
    console.error('Get projects error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch projects',
      error: error.message 
    });
  }
});

// GET all document folders (projects with document count) (Admin only)
router.get('/folders', authMiddleware, adminOnly, async (req, res) => {
  try {
    const projects = await Project.find()
      .select('projectName')
      .sort({ projectName: 1 });

    const foldersWithCount = await Promise.all(
      projects.map(async (project) => {
        const documentCount = await Document.countDocuments({ projectId: project._id });
        return {
          _id: project._id,
          projectName: project.projectName,
          documentCount,
        };
      })
    );

    res.json(foldersWithCount);
  } catch (error: any) {
    console.error('Get folders error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch document folders',
      error: error.message 
    });
  }
});

// GET documents by project ID (Admin only)
router.get('/project/:projectId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;

    const documents = await Document.find({ projectId })
      .populate('uploadedBy', 'name email')
      .populate('projectId', 'projectName')
      .sort({ uploadedAt: -1 });

    res.json(documents);
  } catch (error: any) {
    console.error('Get documents error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch documents',
      error: error.message 
    });
  }
});

// POST upload document (Admin only)
router.post('/upload', authMiddleware, adminOnly, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    console.log('=== UPLOAD DEBUG ===');
    console.log('File:', req.file);
    console.log('Body:', req.body);
    console.log('User:', req.user);
    console.log('===================');

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { projectId } = req.body;

    if (!projectId) {
      // Clean up uploaded file
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: 'Project ID is required' });
    }

    // Check if project exists
    const project = await Project.findById(projectId);
    if (!project) {
      // Clean up uploaded file
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ message: 'Project not found' });
    }

    // Get user ID - check both possible properties
    const userId = req.user?.id || req.user?.userId || req.user?._id;
    
    if (!userId) {
      // Clean up uploaded file
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(401).json({ message: 'User authentication error' });
    }

    console.log('Creating document with userId:', userId);

    const newDocument = await Document.create({
      fileName: req.file.originalname,
      fileUrl: `/uploads/documents/${req.file.filename}`,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      projectId,
      uploadedBy: userId,
    });

    const populatedDocument = await Document.findById(newDocument._id)
      .populate('uploadedBy', 'name email')
      .populate('projectId', 'projectName');

    console.log('Document created successfully:', populatedDocument);

    res.status(201).json({
      message: 'Document uploaded successfully',
      document: populatedDocument,
    });
  } catch (error: any) {
    console.error('Upload document error:', error);
    console.error('Error stack:', error.stack);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Failed to delete uploaded file:', unlinkError);
      }
    }
    
    res.status(500).json({ 
      message: 'Failed to upload document',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// DELETE document (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Delete file from filesystem
    const filePath = path.join(__dirname, '..', document.fileUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await Document.findByIdAndDelete(id);

    res.json({ message: 'Document deleted successfully' });
  } catch (error: any) {
    console.error('Delete document error:', error);
    res.status(500).json({ 
      message: 'Failed to delete document',
      error: error.message 
    });
  }
});

// GET document statistics (Admin only)
router.get('/stats/overview', authMiddleware, adminOnly, async (req, res) => {
  try {
    const totalDocuments = await Document.countDocuments();
    const totalProjects = await Project.countDocuments();
    
    const documents = await Document.find();
    const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0);

    res.json({
      totalDocuments,
      totalProjects,
      totalSize,
    });
  } catch (error: any) {
    console.error('Get stats error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch statistics',
      error: error.message 
    });
  }
});

export default router;