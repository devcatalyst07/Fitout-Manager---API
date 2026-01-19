import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Document from '../models/Document';
import Project from '../models/Projects';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

const router = Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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

// Helper: Upload buffer to Cloudinary
const uploadToCloudinary = (buffer: Buffer, options: any) => {
  return new Promise<any>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    Readable.from(buffer).pipe(uploadStream);
  });
};

// GET all projects for dropdown (Admin only)
router.get('/projects', authMiddleware, adminOnly, async (req, res) => {
  try {
    const projects = await Project.find()
      .select('_id projectName')
      .sort({ projectName: 1 });

    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to fetch projects', error: error.message });
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
    res.status(500).json({ message: 'Failed to fetch document folders', error: error.message });
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
    res.status(500).json({ message: 'Failed to fetch documents', error: error.message });
  }
});

// POST upload document (Admin only)
router.post('/upload', authMiddleware, adminOnly, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ message: 'Project ID is required' });

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const userId = req.user?.id || req.user?.userId || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'User authentication error' });

    const isPDF = req.file.mimetype === 'application/pdf';
    const isImage = req.file.mimetype.startsWith('image/');

    const cloudinaryResult = await uploadToCloudinary(req.file.buffer, {
      folder: 'fitout-documents',
      resource_type: isPDF || !isImage ? 'raw' : 'auto',
      public_id: `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, '')}`,
      format: req.file.originalname.split('.').pop()
    });

    const newDocument = await Document.create({
      fileName: req.file.originalname,
      fileUrl: cloudinaryResult.secure_url,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      projectId,
      uploadedBy: userId,
      cloudinaryPublicId: cloudinaryResult.public_id
    });

    const populatedDocument = await Document.findById(newDocument._id)
      .populate('uploadedBy', 'name email')
      .populate('projectId', 'projectName');

    res.status(201).json({ message: 'Document uploaded successfully', document: populatedDocument });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to upload', error: error.message });
  }
});

// DELETE document (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const document = await Document.findById(id);
    if (!document) return res.status(404).json({ message: 'Document not found' });

    if (document.cloudinaryPublicId) {
      await cloudinary.uploader.destroy(document.cloudinaryPublicId, {
        resource_type: 'raw'
      });
    }

    await Document.findByIdAndDelete(id);

    res.json({ message: 'Document deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to delete document', error: error.message });
  }
});

// GET document statistics (Admin only)
router.get('/stats/overview', authMiddleware, adminOnly, async (req, res) => {
  try {
    const totalDocuments = await Document.countDocuments();
    const totalProjects = await Project.countDocuments();

    const documents = await Document.find();
    const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0);

    res.json({ totalDocuments, totalProjects, totalSize });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to fetch statistics', error: error.message });
  }
});

export default router;
