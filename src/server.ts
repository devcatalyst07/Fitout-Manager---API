import dotenv from "dotenv";
dotenv.config();

import { Request, Response } from "express";
import app from "./app";
import { connectDB, getConnectionStatus } from "./config/database";
import { createAdmin } from "./seed/createAdmin";
import { startReminderCron } from "./services/reminderService";

/**
 * Vercel Serverless Function Handler
 * Optimized for cold starts and connection reuse.
 *
 * CORS NOTE:
 *   All CORS handling (including OPTIONS preflight) is done entirely inside
 *   app.ts via the cors() middleware + app.options("*", cors()).
 *   Do NOT add any manual CORS header logic here — it creates a conflict
 *   where two sets of Access-Control-* headers are sent and the browser
 *   rejects the response.
 */

// ─── Initialization state ────────────────────────────────────────────────────
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize the application once per serverless instance.
 * Uses promise caching to prevent duplicate work on concurrent cold starts.
 */
async function initialize(): Promise<void> {
  if (isInitialized) return;

  if (initializationPromise) {
    console.log("⏳ Initialization in progress, waiting...");
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      console.log("🚀 Initializing application...");

      await connectDB();
      console.log("   ✅ Database:", getConnectionStatus());

      await createAdmin();
      console.log("   ✅ Admin user check complete");

      startReminderCron();
      console.log("   ✅ Reminder cron started");

      isInitialized = true;
      console.log("✅ Application initialized successfully");
    } catch (error) {
      console.error("❌ Initialization failed:", error);
      // Reset so the next request can retry
      isInitialized = false;
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
}

// ─── Serverless handler ───────────────────────────────────────────────────────
const handler = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  try {
    // ✅ Delegate EVERYTHING (including OPTIONS preflight and CORS headers)
    //    to the Express app. app.ts already has:
    //      app.use(cors(corsOptions))
    //      app.options("*", cors(corsOptions))
    //    Adding manual headers here would conflict with those.

    // Ensure DB is ready before handing off to Express
    await initialize();

    // Reconnect if the serverless instance lost its DB connection
    if (getConnectionStatus() !== "connected") {
      console.log("🔄 Reconnecting to database...");
      await connectDB();
    }

    // Hand the request to Express — it handles CORS, routing, auth, everything
    await app(req, res);

    console.log(`✅ ${req.method} ${req.url} completed in ${Date.now() - startTime}ms`);
  } catch (error: any) {
    console.error(`❌ Handler error after ${Date.now() - startTime}ms:`, error);

    // Don't write a second response if Express already started one
    if (res.headersSent) return;

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error",
      code: error.code || "INTERNAL_ERROR",
      ...(process.env.NODE_ENV === "development" && {
        error: String(error),
        stack: error.stack,
      }),
    });
  }
};

export default handler;