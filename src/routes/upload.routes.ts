import express from 'express';
import { authMiddleware } from "../middleware/auth";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
    const mimeType = allowedTypes.test(file.mimetype);
    if (mimeType) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only images, PDFs, and documents are allowed.",
        ),
      );
    }
  },
});

// Upload file to Cloudinary
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req: express.Request, res: express.Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const b64 = Buffer.from(req.file.buffer).toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;

      // Upload to Cloudinary
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: "fitout-manager/task-attachments",
        resource_type: "auto",
      });

      res.json({
        message: "File uploaded successfully",
        file: {
          fileName: req.file.originalname,
          fileUrl: result.secure_url,
          fileType: req.file.mimetype,
          fileSize: req.file.size,
          publicId: result.public_id, // For deletion lang to if needed
        },
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      res
        .status(500)
        .json({ message: "Failed to upload file", error: error.message });
    }
  },
);

// Delete file from Cloudinary (optional lang 'to)
router.delete(
  "/upload/:publicId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { publicId } = req.params;
      const decodedPublicId = decodeURIComponent(publicId);

      await cloudinary.uploader.destroy(decodedPublicId);

      res.json({ message: "File deleted successfully" });
    } catch (error: any) {
      console.error("Delete error:", error);
      res
        .status(500)
        .json({ message: "Failed to delete file", error: error.message });
    }
  },
);

export default router;
