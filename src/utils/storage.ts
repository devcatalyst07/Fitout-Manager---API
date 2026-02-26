import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

// ─── Configuration ──────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Upload ─────────────────────────────────────────────────────────────────
/**
 * Uploads a multer file buffer to Cloudinary.
 *
 * @param file   - Express.Multer.File (memory or disk storage)
 * @param folder - Cloudinary folder path, e.g. "tenders/projectId"
 * @returns      - Secure URL of the uploaded file
 */
export async function uploadToStorage(
  file: Express.Multer.File,
  folder: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "auto",          // handles PDFs, images, ZIPs, DWGs, etc.
        use_filename: true,             // preserves the original filename
        unique_filename: true,          // appends a unique suffix to avoid collisions
        access_mode: "authenticated",  // files are private by default; remove if you want public URLs
      },
      (error, result) => {
        if (error || !result) {
          return reject(error ?? new Error("Cloudinary upload returned no result"));
        }
        resolve(result.secure_url);
      }
    );

    // Support both memory storage (buffer) and disk storage (path via fs stream)
    if (file.buffer) {
      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    } else if (file.path) {
      const fs = require("fs") as typeof import("fs");
      fs.createReadStream(file.path).pipe(uploadStream);
    } else {
      reject(new Error("File has neither buffer nor path — check multer storage config"));
    }
  });
}

// ─── Delete ─────────────────────────────────────────────────────────────────
/**
 * Deletes a file from Cloudinary given its secure URL.
 *
 * Extracts the public_id (folder/filename without extension) from the URL
 * and calls the Cloudinary destroy API.
 *
 * @param fileUrl - The secure_url returned by Cloudinary on upload
 */
export async function deleteFromStorage(fileUrl: string): Promise<void> {
  try {
    const publicId = extractPublicId(fileUrl);
    if (!publicId) {
      console.warn("[storage] Could not extract public_id from URL:", fileUrl);
      return;
    }

    // Cloudinary needs resource_type "raw" for non-image files (PDFs, ZIPs, etc.)
    // Try "raw" first, fall back to "image" for image files
    const result = await cloudinary.uploader
      .destroy(publicId, { resource_type: "raw" })
      .catch(() => cloudinary.uploader.destroy(publicId, { resource_type: "image" }));

    if (result.result !== "ok" && result.result !== "not found") {
      console.warn("[storage] Cloudinary delete unexpected result:", result);
    }
  } catch (error) {
    // Non-fatal — caller uses .catch(() => {}) to swallow errors
    console.error("[storage] Failed to delete from Cloudinary:", error);
    throw error;
  }
}

// ─── Helper ──────────────────────────────────────────────────────────────────
/**
 * Extracts the Cloudinary public_id from a secure URL.
 *
 * Example URL:
 *   https://res.cloudinary.com/dfzxiz2uv/raw/upload/v1234567890/tenders/abc123/filename.pdf
 * Extracted public_id:
 *   tenders/abc123/filename
 */
function extractPublicId(url: string): string | null {
  try {
    // Match everything after /upload/v<version>/ and strip the file extension
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(\.[^.]+)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}