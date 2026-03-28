import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import path from "path";

// ─── R2 Client ───────────────────────────────────────────────────────────────

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "fitoutmanager";

// Optional: public domain if you configured one in Cloudflare dashboard
// e.g.  https://files.yourdomain.com  or  https://pub-xxx.r2.dev
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitize a filename so it's safe for S3 keys
 */
function sanitizeFileName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .substring(0, 100);
  return `${base}-${uuidv4().substring(0, 8)}${ext}`;
}

/**
 * Build the object key (path inside the bucket)
 */
function buildKey(folder: string, fileName: string): string {
  // Remove leading/trailing slashes from folder
  const cleanFolder = folder.replace(/^\/|\/$/g, "");
  return `${cleanFolder}/${fileName}`;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export interface UploadResult {
  /** Full public URL (if R2_PUBLIC_URL is set) or empty string */
  fileUrl: string;
  /** R2 object key — store this in the DB to be able to delete later */
  key: string;
  /** Signed URL valid for 7 days — use this when R2_PUBLIC_URL is not set */
  signedUrl: string;
}

/**
 * Upload a multer file buffer to Cloudflare R2.
 *
 * @param file   - Express.Multer.File
 * @param folder - Virtual folder path inside the bucket, e.g. "documents/projectId"
 */
export async function uploadToR2(
  file: Express.Multer.File,
  folder: string
): Promise<UploadResult> {
  const safeFileName = sanitizeFileName(file.originalname);
  const key = buildKey(folder, safeFileName);

  // Determine content type
  const contentType = file.mimetype || "application/octet-stream";

  // Read buffer
  const body = file.buffer;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Store original filename as metadata
    Metadata: {
      "original-name": encodeURIComponent(file.originalname),
    },
  });

  await r2Client.send(command);

  // Build permanent public URL (only works if bucket has public access enabled)
  const fileUrl = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : "";

  // Generate a presigned URL valid for 7 days (used when no public domain)
  const getCommand = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  const signedUrl = await getSignedUrl(r2Client, getCommand, {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  });

  return {
    fileUrl: fileUrl || signedUrl, // fallback to signed URL if no public domain
    key,
    signedUrl,
  };
}

/**
 * Upload raw buffer (not a multer file) directly to R2.
 * Useful for programmatic uploads.
 */
export async function uploadBufferToR2(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  folder: string
): Promise<UploadResult> {
  const fakeFile = {
    buffer,
    originalname: originalName,
    mimetype: mimeType,
  } as Express.Multer.File;

  return uploadToR2(fakeFile, folder);
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Delete a file from R2 by its object key.
 *
 * @param key - The key returned by uploadToR2 (e.g. "documents/project123/file-abc.pdf")
 */
export async function deleteFromR2(key: string): Promise<void> {
  if (!key) {
    console.warn("[R2] deleteFromR2 called with empty key — skipping");
    return;
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    await r2Client.send(command);
    console.log(`[R2] Deleted: ${key}`);
  } catch (error) {
    console.error(`[R2] Failed to delete ${key}:`, error);
    throw error;
  }
}

/**
 * Extract the R2 key from a stored URL.
 * Works whether the URL is a public URL or a signed URL.
 */
export function extractKeyFromUrl(url: string): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    // Signed URL: key is in the pathname after the bucket endpoint
    // Public URL: key is the full pathname minus leading slash
    let pathname = parsed.pathname;

    // Remove leading slash
    if (pathname.startsWith("/")) {
      pathname = pathname.substring(1);
    }

    // If the pathname starts with the bucket name (R2 signed URLs include it)
    if (pathname.startsWith(`${BUCKET_NAME}/`)) {
      pathname = pathname.substring(BUCKET_NAME.length + 1);
    }

    return pathname || null;
  } catch {
    return null;
  }
}

// ─── Presigned URL (on-demand access) ────────────────────────────────────────

/**
 * Generate a fresh presigned URL for an existing R2 object.
 * Call this when serving private files to users.
 *
 * @param key       - The R2 object key
 * @param expiresIn - Seconds until expiry (default 1 hour)
 */
export async function getPresignedUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Check whether an object exists in R2.
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2Client.send(
      new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key })
    );
    return true;
  } catch {
    return false;
  }
}

export default r2Client;