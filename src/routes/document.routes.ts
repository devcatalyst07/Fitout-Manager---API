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
    const allowedTypes = /pdf|doc|docx|xlsx|xls|png|jpg|jpeg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only documents and images are allowed'));
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
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ message: 'Failed to fetch projects' });
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
  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ message: 'Failed to fetch document folders' });
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
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
});

// POST upload document (Admin only)
router.post('/upload', authMiddleware, adminOnly, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: 'Project ID is required' });
    }

    // Check if project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const newDocument = await Document.create({
      fileName: req.file.originalname,
      fileUrl: `/uploads/documents/${req.file.filename}`,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      projectId,
      uploadedBy: req.user.id,
    });

    const populatedDocument = await Document.findById(newDocument._id)
      .populate('uploadedBy', 'name email')
      .populate('projectId', 'projectName');

    res.status(201).json({
      message: 'Document uploaded successfully',
      document: populatedDocument,
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ message: 'Failed to upload document' });
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
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ message: 'Failed to delete document' });
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
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Failed to fetch statistics' });
  }
});

export default router;