// src/routes/upload.routes.ts
// UPDATED: Uses Cloudflare R2 instead of Cloudinary

import express from "express";
import { authMiddleware } from "../middleware/auth";
import multer from "multer";
import { uploadToR2, deleteFromR2, extractKeyFromUrl } from "../utils/r2Storage";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|plain|text/;
    const mimeType = allowedTypes.test(file.mimetype);
    if (mimeType) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only images, PDFs, Word, Excel, and text files are allowed."
        )
      );
    }
  },
});

// ─── POST /api/upload ────────────────────────────────────────────────────────
router.post(
  "/upload",
  authMiddleware,
  upload.fields([
    { name: "file", maxCount: 10 },
    { name: "files", maxCount: 10 },
  ]),
  async (req: express.Request, res: express.Response) => {
    try {
      const uploadFiles = [
        ...(((req.files as Record<string, Express.Multer.File[]>)?.file ||
          []) as Express.Multer.File[]),
        ...(((req.files as Record<string, Express.Multer.File[]>)?.files ||
          []) as Express.Multer.File[]),
      ];

      if (uploadFiles.length === 0) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const totalSize = uploadFiles.reduce((sum, file) => sum + file.size, 0);
      if (totalSize > 100 * 1024 * 1024) {
        return res.status(400).json({
          message: "Total upload size cannot exceed 100MB",
        });
      }

      const uploadedFiles = await Promise.all(
        uploadFiles.map(async (file) => {
          const folder = "task-attachments";
          const { fileUrl, key } = await uploadToR2(file, folder);

          return {
            fileName: file.originalname,
            fileUrl,
            fileType: file.mimetype,
            fileSize: file.size,
            publicId: key, // R2 key (used to be Cloudinary publicId)
          };
        })
      );

      const firstFile = uploadedFiles[0];

      res.json({
        message: "File uploaded successfully",
        file: firstFile,
        files: uploadedFiles,
        urls: uploadedFiles.map((f) => f.fileUrl),
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      res
        .status(500)
        .json({ message: "Failed to upload file", error: error.message });
    }
  }
);

// ─── DELETE /api/upload/:publicId ────────────────────────────────────────────
// publicId here is URL-encoded R2 key
router.delete(
  "/upload/:publicId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { publicId } = req.params;
      const key = decodeURIComponent(publicId);

      await deleteFromR2(key);

      res.json({ message: "File deleted successfully" });
    } catch (error: any) {
      console.error("Delete error:", error);
      res
        .status(500)
        .json({ message: "Failed to delete file", error: error.message });
    }
  }
);

export default router;