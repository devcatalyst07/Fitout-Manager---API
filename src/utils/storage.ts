import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import streamifier from "streamifier";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Re-export everything from r2Storage so existing imports keep working
export {
  uploadToR2 as uploadToStorage,
  deleteFromR2 as deleteFromStorage,
  getPresignedUrl,
} from "./r2Storage";

// Keep the original function signature for backward compatibility with tender routes
import { uploadToR2, deleteFromR2 } from "./r2Storage";

/**
 * @deprecated Use uploadToR2 from r2Storage instead.
 * Kept here for backward compatibility with any code that imports from storage.ts
 */
export async function uploadFile(
  file: Express.Multer.File,
  folder: string
): Promise<string> {
  const { fileUrl } = await uploadToR2(file, folder);
  return fileUrl;
}

/**
 * @deprecated Use deleteFromR2 from r2Storage instead.
 */
export async function deleteFile(key: string): Promise<void> {
  return deleteFromR2(key);
}