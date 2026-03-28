// src/routes/document.routes.ts
// UPDATED: Uses Cloudflare R2 instead of Cloudinary

import express from "express";
import { authMiddleware } from "../middleware/auth";
import Document from "../models/Document";
import Project from "../models/Projects";
import multer from "multer";
import { uploadToR2, deleteFromR2, getPresignedUrl } from "../utils/r2Storage";
import { activityHelpers } from "../utils/activityLogger";

const router = express.Router();

// Multer memory storage — no change needed here
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
          "Only PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG files are allowed"
        )
      );
    }
  },
});

// ============================================
// GET /api/documents/projects
// ============================================
router.get(
  "/projects",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      let projectFilter: any = {};

      if (req.user!.role === "admin") {
        projectFilter = { userId: req.user!.id };
      } else {
        const TeamMember = require("../models/TeamMember").default;
        const teamMembers = await TeamMember.find({
          userId: req.user!.id,
          status: "active",
        });

        const projectIds = teamMembers.map((tm: any) => tm.projectId);
        if (projectIds.length === 0) return res.json([]);

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
  }
);

// ============================================
// GET /api/documents/folders
// ============================================
router.get(
  "/folders",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      let projectFilter: any = {};

      if (req.user!.role === "admin") {
        projectFilter = { userId: req.user!.id };
      } else {
        const TeamMember = require("../models/TeamMember").default;
        const teamMembers = await TeamMember.find({
          userId: req.user!.id,
          status: "active",
        });

        const projectIds = teamMembers.map((tm: any) => tm.projectId);
        if (projectIds.length === 0) return res.json([]);

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
        })
      );

      res.json(foldersWithCount);
    } catch (error: any) {
      res.status(500).json({
        message: "Failed to fetch document folders",
        error: error.message,
      });
    }
  }
);

// ============================================
// GET /api/documents/project/:projectId
// ============================================
router.get(
  "/project/:projectId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;

      const project = await Project.findById(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      if (req.user!.role !== "admin") {
        const TeamMember = require("../models/TeamMember").default;
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId,
          status: "active",
        });
        if (!teamMember)
          return res
            .status(403)
            .json({ message: "Not authorized to access this project" });
      } else if (String(project.userId) !== String(req.user!.id)) {
        return res
          .status(403)
          .json({ message: "Not authorized to access this project" });
      }

      const documents = await Document.find({ projectId })
        .populate("uploadedBy", "name email")
        .populate("projectId", "projectName")
        .sort({ uploadedAt: -1 });

      // Generate fresh presigned URLs for each document
      // (only needed when R2_PUBLIC_URL is not set)
      const docsWithUrls = await Promise.all(
        documents.map(async (doc) => {
          const obj = doc.toObject() as any;
          // If the stored URL is already a permanent public URL, use it as-is
          // Otherwise refresh the signed URL using the stored R2 key
          if (obj.r2Key && !process.env.R2_PUBLIC_URL) {
            try {
              obj.fileUrl = await getPresignedUrl(obj.r2Key, 3600 * 24); // 24h
            } catch {
              // keep existing URL
            }
          }
          return obj;
        })
      );

      res.json(docsWithUrls);
    } catch (error: any) {
      res
        .status(500)
        .json({ message: "Failed to fetch documents", error: error.message });
    }
  }
);

// ============================================
// POST /api/documents/upload  ← USES R2 NOW
// ============================================
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req: express.Request, res: express.Response) => {
    try {
      if (!req.file)
        return res.status(400).json({ message: "No file uploaded" });

      const { projectId } = req.body;
      if (!projectId)
        return res.status(400).json({ message: "Project ID is required" });

      const project = await Project.findById(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      if (req.user!.role !== "admin") {
        const TeamMember = require("../models/TeamMember").default;
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId,
          status: "active",
        });
        if (!teamMember)
          return res
            .status(403)
            .json({ message: "Not authorized to upload to this project" });
      } else if (String(project.userId) !== String(req.user!.id)) {
        return res
          .status(403)
          .json({ message: "Not authorized to upload to this project" });
      }

      const userId = req.user?.id;
      if (!userId)
        return res.status(401).json({ message: "User authentication error" });

      // ── Upload to R2 ──
      const folder = `documents/${projectId}`;
      const { fileUrl, key } = await uploadToR2(req.file, folder);

      const newDocument = await Document.create({
        fileName: req.file.originalname,
        fileUrl,
        fileSize: req.file.size,
        fileType: req.file.mimetype,
        projectId,
        uploadedBy: userId,
        // Store R2 key for later deletion/presigning
        cloudinaryPublicId: key, // reusing this field to store R2 key
      });

      const populatedDocument = await Document.findById(newDocument._id)
        .populate("uploadedBy", "name email")
        .populate("projectId", "projectName");

      await activityHelpers.documentUploaded(
        projectId,
        userId,
        req.user!.name || "User",
        req.file.originalname,
        req.user!.email
      );

      res.status(201).json({
        message: "Document uploaded successfully",
        document: populatedDocument,
      });
    } catch (error: any) {
      console.error("Document upload error:", error);
      res
        .status(500)
        .json({ message: "Failed to upload", error: error.message });
    }
  }
);

// ============================================
// DELETE /api/documents/:id  ← USES R2 NOW
// ============================================
router.delete(
  "/:id",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;

      const document = await Document.findById(id);
      if (!document)
        return res.status(404).json({ message: "Document not found" });

      if (req.user!.role !== "admin") {
        const TeamMember = require("../models/TeamMember").default;
        const teamMember = await TeamMember.findOne({
          userId: req.user!.id,
          projectId: document.projectId,
          status: "active",
        });
        if (!teamMember)
          return res
            .status(403)
            .json({ message: "Not authorized to delete this document" });
      }

      // ── Delete from R2 using the stored key ──
      if (document.cloudinaryPublicId) {
        await deleteFromR2(document.cloudinaryPublicId).catch((err) =>
          console.warn("[R2] Delete warning:", err)
        );
      }

      await Document.findByIdAndDelete(id);

      await activityHelpers.documentDeleted(
        document.projectId.toString(),
        req.user!.id,
        req.user!.name || "User",
        document.fileName,
        req.user!.email
      );

      res.json({ message: "Document deleted successfully" });
    } catch (error: any) {
      res
        .status(500)
        .json({ message: "Failed to delete document", error: error.message });
    }
  }
);

// ============================================
// GET /api/documents/stats/overview
// ============================================
router.get(
  "/stats/overview",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      let projectFilter: any = {};

      if (req.user!.role === "admin") {
        projectFilter = { userId: req.user!.id };
      } else {
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
      const documents = await Document.find({
        projectId: { $in: projectIds },
      });
      const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0);

      res.json({
        totalDocuments,
        totalProjects: projects.length,
        totalSize,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ message: "Failed to fetch statistics", error: error.message });
    }
  }
);

export default router;