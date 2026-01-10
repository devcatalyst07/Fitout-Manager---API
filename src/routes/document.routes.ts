import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Document from '../models/Document';
import Project from '../models/Projects';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const router = Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'fitout-documents',
    resource_type: 'raw', // For documents (PDFs, DOC, etc.)
    access_mode: 'public', // Make files publicly accessible
    format: async (req: any, file: any) => {
      const ext = file.originalname.split('.').pop();
      return ext;
    },
    public_id: (req: any, file: any) => {
      return `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '')}`;
    },
  } as any,
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
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

    if (allowedMimeTypes.includes(file.mimetype)) {
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
router.post('/upload', authMiddleware, adminOnly, (req: AuthRequest, res) => {
  // Wrap multer upload in error handler
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('Multer/Cloudinary error:', err);
      return res.status(400).json({ 
        message: err.message || 'File upload error',
        error: err.toString()
      });
    }

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
        // Delete from Cloudinary if project ID is missing
        if ((req.file as any).filename) {
          await cloudinary.uploader.destroy((req.file as any).filename);
        }
        return res.status(400).json({ message: 'Project ID is required' });
      }

      // Check if project exists
      const project = await Project.findById(projectId);
      if (!project) {
        // Delete from Cloudinary if project doesn't exist
        if ((req.file as any).filename) {
          await cloudinary.uploader.destroy((req.file as any).filename);
        }
        return res.status(404).json({ message: 'Project not found' });
      }

      // Get user ID - check both possible properties
      const userId = req.user?.id || req.user?.userId || req.user?._id;
      
      if (!userId) {
        // Delete from Cloudinary if user auth fails
        if ((req.file as any).filename) {
          await cloudinary.uploader.destroy((req.file as any).filename);
        }
        return res.status(401).json({ message: 'User authentication error' });
      }

      console.log('Creating document with userId:', userId);

      // Cloudinary file info
      const cloudinaryFile = req.file as any;
      
      // For PDFs, generate a URL that displays inline instead of downloading
      let fileUrl = cloudinaryFile.path;
      if (req.file.mimetype === 'application/pdf') {
        // Replace /raw/upload/ with /image/upload/fl_attachment:inline/
        fileUrl = cloudinaryFile.path.replace('/raw/upload/', '/image/upload/fl_attachment:inline/');
      }

      const newDocument = await Document.create({
        fileName: req.file.originalname,
        fileUrl: fileUrl, // Use modified URL for PDFs
        fileSize: cloudinaryFile.size,
        fileType: cloudinaryFile.mimetype,
        projectId,
        uploadedBy: userId,
        cloudinaryPublicId: cloudinaryFile.filename, // Store for deletion later
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
      
      // Clean up Cloudinary upload on error
      if (req.file && (req.file as any).filename) {
        try {
          await cloudinary.uploader.destroy((req.file as any).filename);
        } catch (deleteError) {
          console.error('Failed to delete from Cloudinary:', deleteError);
        }
      }
      
      res.status(500).json({ 
        message: 'Failed to upload document',
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });
});

// DELETE document (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Delete from Cloudinary using public_id
    if (document.cloudinaryPublicId) {
      try {
        await cloudinary.uploader.destroy(document.cloudinaryPublicId, {
          resource_type: 'raw' // Use 'raw' for non-image files
        });
      } catch (cloudinaryError) {
        console.error('Cloudinary deletion error:', cloudinaryError);
        // Continue with database deletion even if Cloudinary fails
      }
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