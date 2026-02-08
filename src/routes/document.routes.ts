import express from 'express';
import { authMiddleware } from "../middleware/auth";
import Document from "../models/Document";
import Project from "../models/Projects";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/png",
      "image/jpeg",
      "image/jpg",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG files are allowed",
        ),
      );
    }
  },
});

// Helper: Upload buffer to Cloudinary
const uploadToCloudinary = (buffer: Buffer, options: any) => {
  return new Promise<any>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );

    Readable.from(buffer).pipe(uploadStream);
  });
};

// ============================================
// GET /api/documents/projects - Get all projects for dropdown
// ✅ UPDATED: Filter based on user role
// ============================================
router.get("/projects", authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    let projectFilter: any = {};

    if (req.user!.role === "admin") {
      // Admin sees all projects
      projectFilter = {};
    } else {
      // User sees only assigned projects
      const TeamMember = require("../models/TeamMember").default;
      const teamMembers = await TeamMember.find({
        userId: req.user!.id,
        status: "active",
      });

      const projectIds = teamMembers.map((tm: any) => tm.projectId);

      if (projectIds.length === 0) {
        return res.json([]);
      }

      projectFilter._id = { $in: projectIds };
    }

    const projects = await Project.find(projectFilter)
      .select("_id projectName")
      .sort({ projectName: 1 });

    res.json(projects);
  } catch (error: any) {
    res
      .status(500)
      .json({ message: "Failed to fetch projects", error: error.message });
  }
});

// ============================================
// GET /api/documents/folders - Get all document folders
// ✅ UPDATED: Filter based on user role
// ============================================
router.get("/folders", authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    let projectFilter: any = {};

    if (req.user!.role === "admin") {
      // Admin sees all projects
      projectFilter = {};
    } else {
      // User sees only assigned projects
      const TeamMember = require("../models/TeamMember").default;
      const teamMembers = await TeamMember.find({
        userId: req.user!.id,
        status: "active",
      });

      const projectIds = teamMembers.map((tm: any) => tm.projectId);

      if (projectIds.length === 0) {
        return res.json([]);
      }

      projectFilter._id = { $in: projectIds };
    }

    const projects = await Project.find(projectFilter)
      .select("projectName")
      .sort({ projectName: 1 });

    const foldersWithCount = await Promise.all(
      projects.map(async (project) => {
        const documentCount = await Document.countDocuments({
          projectId: project._id,
        });
        return {
          _id: project._id,
          projectName: project.projectName,
          documentCount,
        };
      }),
    );

    res.json(foldersWithCount);
  } catch (error: any) {
    res
      .status(500)
      .json({
        message: "Failed to fetch document folders",
        error: error.message,
      });
  }
});

// ============================================
// GET /api/documents/project/:projectId - Get documents by project
// ✅ UPDATED: Check project access
// ============================================
router.get(
  "/project/:projectId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;

      // Check project access for users
      if (req.user!.role !== "admin") {
        const TeamMember = require("../models/TeamMember").default;
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId: projectId,
          status: "active",
        });

        if (!teamMember) {
          return res
            .status(403)
            .json({ message: "Not authorized to access this project" });
        }
      }

      const documents = await Document.find({ projectId })
        .populate("uploadedBy", "name email")
        .populate("projectId", "projectName")
        .sort({ uploadedAt: -1 });

      res.json(documents);
    } catch (error: any) {
      res
        .status(500)
        .json({ message: "Failed to fetch documents", error: error.message });
    }
  },
);

// ============================================
// POST /api/documents/upload - Upload document
// ✅ UPDATED: Check project access for users
// ============================================
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req: express.Request, res: express.Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { projectId } = req.body;
      if (!projectId)
        return res.status(400).json({ message: "Project ID is required" });

      const project = await Project.findById(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      // Check project access for users
      if (req.user!.role !== "admin") {
        const TeamMember = require("../models/TeamMember").default;
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId: projectId,
          status: "active",
        });

        if (!teamMember) {
          return res
            .status(403)
            .json({ message: "Not authorized to upload to this project" });
        }
      }

      const userId = req.user?.id;
      if (!userId)
        return res.status(401).json({ message: "User authentication error" });

      const isPDF = req.file.mimetype === "application/pdf";
      const isImage = req.file.mimetype.startsWith("image/");

      const cloudinaryResult = await uploadToCloudinary(req.file.buffer, {
        folder: "fitout-documents",
        resource_type: isPDF || !isImage ? "raw" : "auto",
        public_id: `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, "")}`,
        format: req.file.originalname.split(".").pop(),
      });

      const newDocument = await Document.create({
        fileName: req.file.originalname,
        fileUrl: cloudinaryResult.secure_url,
        fileSize: req.file.size,
        fileType: req.file.mimetype,
        projectId,
        uploadedBy: userId,
        cloudinaryPublicId: cloudinaryResult.public_id,
      });

      const populatedDocument = await Document.findById(newDocument._id)
        .populate("uploadedBy", "name email")
        .populate("projectId", "projectName");

      res
        .status(201)
        .json({
          message: "Document uploaded successfully",
          document: populatedDocument,
        });
    } catch (error: any) {
      res
        .status(500)
        .json({ message: "Failed to upload", error: error.message });
    }
  },
);

// ============================================
// DELETE /api/documents/:id - Delete document
// ✅ UPDATED: Check project access for users
// ============================================
router.delete("/:id", authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;

    const document = await Document.findById(id);
    if (!document)
      return res.status(404).json({ message: "Document not found" });

    // Check project access for users
    if (req.user!.role !== "admin") {
      const TeamMember = require("../models/TeamMember").default;
      const teamMember = await TeamMember.findOne({
        userId: req.user!.id,
        projectId: document.projectId,
        status: "active",
      });

      if (!teamMember) {
        return res
          .status(403)
          .json({ message: "Not authorized to delete this document" });
      }
    }

    if (document.cloudinaryPublicId) {
      await cloudinary.uploader.destroy(document.cloudinaryPublicId, {
        resource_type: "raw",
      });
    }

    await Document.findByIdAndDelete(id);

    res.json({ message: "Document deleted successfully" });
  } catch (error: any) {
    res
      .status(500)
      .json({ message: "Failed to delete document", error: error.message });
  }
});

// ============================================
// GET /api/documents/stats/overview - Document statistics
// ✅ UPDATED: Filter based on user role
// ============================================
router.get("/stats/overview", authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    let projectFilter: any = {};

    if (req.user!.role === "admin") {
      // Admin sees all
      projectFilter = {};
    } else {
      // User sees only assigned projects
      const TeamMember = require("../models/TeamMember").default;
      const teamMembers = await TeamMember.find({
        userId: req.user!.id,
        status: "active",
      });

      const projectIds = teamMembers.map((tm: any) => tm.projectId);

      if (projectIds.length === 0) {
        return res.json({
          totalDocuments: 0,
          totalProjects: 0,
          totalSize: 0,
        });
      }

      projectFilter._id = { $in: projectIds };
    }

    const projects = await Project.find(projectFilter);
    const projectIds = projects.map((p) => p._id);

    const totalDocuments = await Document.countDocuments({
      projectId: { $in: projectIds },
    });
    const totalProjects = projects.length;

    const documents = await Document.find({
      projectId: { $in: projectIds },
    });
    const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0);

    res.json({ totalDocuments, totalProjects, totalSize });
  } catch (error: any) {
    res
      .status(500)
      .json({ message: "Failed to fetch statistics", error: error.message });
  }
});

export default router;