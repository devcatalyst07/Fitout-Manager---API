import { Router, Request } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { Express } from 'express';

import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Document from '../models/Document';
import Project from '../models/Projects';

const router = Router();

/* ======================================================
   CLOUDINARY CONFIG
====================================================== */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

/* ======================================================
   MULTER STORAGE
====================================================== */

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (_req: Request, file: Express.Multer.File) => ({
    folder: 'fitout-documents',
    resource_type: file.mimetype.startsWith('image/')
      ? 'image'
      : 'raw', // ✅ PDFs stay RAW
    public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '')}`,
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'image/jpg',
    ];

    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Unsupported file type'));
  },
});

/* ======================================================
   GET PROJECTS
====================================================== */

router.get('/projects', authMiddleware, adminOnly, async (_req, res) => {
  try {
    const projects = await Project.find()
      .select('_id projectName')
      .sort({ projectName: 1 });

    res.json(projects);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/* ======================================================
   GET DOCUMENT FOLDERS
====================================================== */

router.get('/folders', authMiddleware, adminOnly, async (_req, res) => {
  try {
    const projects = await Project.find()
      .select('_id projectName')
      .sort({ projectName: 1 });

    const folders = await Promise.all(
      projects.map(async (project) => ({
        _id: project._id,
        projectName: project.projectName,
        documentCount: await Document.countDocuments({
          projectId: project._id,
        }),
      }))
    );

    res.json(folders);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/* ======================================================
   GET DOCUMENTS BY PROJECT
====================================================== */

router.get(
  '/project/:projectId',
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const documents = await Document.find({
        projectId: req.params.projectId,
      })
        .populate('uploadedBy', 'name email')
        .populate('projectId', 'projectName')
        .sort({ uploadedAt: -1 });

      res.json(documents);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

/* ======================================================
   UPLOAD DOCUMENT
====================================================== */

router.post(
  '/upload',
  authMiddleware,
  adminOnly,
  (req: AuthRequest, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }

      try {
        if (!req.file) {
          return res.status(400).json({ message: 'No file uploaded' });
        }

        const { projectId } = req.body;
        if (!projectId) {
          return res.status(400).json({ message: 'Project ID required' });
        }

        const project = await Project.findById(projectId);
        if (!project) {
          return res.status(404).json({ message: 'Project not found' });
        }

        const userId =
          req.user?.id || req.user?.userId || req.user?._id;

        if (!userId) {
          return res.status(401).json({ message: 'Unauthorized' });
        }

        const document = await Document.create({
          fileName: req.file.originalname,
          fileUrl: (req.file as any).path,
          fileSize: (req.file as any).size,
          fileType: req.file.mimetype,
          projectId,
          uploadedBy: userId,
          cloudinaryPublicId: (req.file as any).filename,
        });

        const populated = await Document.findById(document._id)
          .populate('uploadedBy', 'name email')
          .populate('projectId', 'projectName');

        res.status(201).json({
          message: 'Document uploaded successfully',
          document: populated,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    });
  }
);

/* ======================================================
   DELETE DOCUMENT
====================================================== */

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (doc.cloudinaryPublicId) {
      await cloudinary.uploader.destroy(doc.cloudinaryPublicId, {
        resource_type: doc.fileType.startsWith('image/')
          ? 'image'
          : 'raw',
      });
    }

    await doc.deleteOne();
    res.json({ message: 'Document deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/* ======================================================
   STATS
====================================================== */

router.get(
  '/stats/overview',
  authMiddleware,
  adminOnly,
  async (_req, res) => {
    try {
      const totalDocuments = await Document.countDocuments();
      const totalProjects = await Project.countDocuments();
      const documents = await Document.find();

      const totalSize = documents.reduce(
        (sum, doc) => sum + doc.fileSize,
        0
      );

      res.json({ totalDocuments, totalProjects, totalSize });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;
