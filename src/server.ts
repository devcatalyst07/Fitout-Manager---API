import dotenv from 'dotenv';
dotenv.config();

import { Request, Response } from 'express';
import app from './app';
import { connectDB, getConnectionStatus } from './config/database';
import { createAdmin } from './seed/createAdmin';
import { getAllowedOrigins } from './config/security';
import { cleanupUnverifiedUsers } from './utils/cleanup';

/**
 * Vercel Serverless Function Handler
 * Optimized for cold starts and connection reuse
 */

// Track initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize application (database, admin user, etc.)
 * Uses promise caching to prevent duplicate initialization
 */
async function initialize(): Promise<void> {
  // Return immediately if already initialized
  if (isInitialized) {
    console.log('Application already initialized');
    return;
  }

  // Return existing initialization promise if one is in progress
  if (initializationPromise) {
    console.log('Initialization in progress, waiting...');
    return initializationPromise;
  }

  // Create new initialization promise
  initializationPromise = (async () => {
    try {
      console.log('Initializing application...');
      
      // Connect to database (uses global connection cache)
      await connectDB();
      console.log('   Database Status:', getConnectionStatus());
      
      // Create admin user if it doesn't exist
      await createAdmin();
      console.log('   Admin user check complete');
      
      // Run cleanup for unverified users (serverless cold start)
      await cleanupUnverifiedUsers();
      
      isInitialized = true;
      console.log('Application initialized successfully');
    } catch (error) {
      console.error('Initialization failed:', error);
      // Reset initialization state on error so it can be retried
      isInitialized = false;
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Set CORS headers dynamically based on request origin
 */
function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();

  // Log request details
  console.log('📨 Request:', {
    method: req.method,
    url: req.url,
    origin: origin || 'none',
  });

  // Check if origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type,Authorization,X-CSRF-Token,Cookie,X-Requested-With'
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-CSRF-Token,Set-Cookie');
    res.setHeader('Access-Control-Max-Age', '86400');
    console.log('CORS headers set for:', origin);
  } else if (origin) {
    console.log('Origin not in allowed list:', origin);
  }
}

/**
 * Main serverless function handler
 */
const handler = async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Set CORS headers
    setCorsHeaders(req, res);

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      console.log('Preflight request handled');
      return res.status(204).end();
    }

    // Initialize application (with promise caching)
    await initialize();

    // Check database connection status
    const dbStatus = getConnectionStatus();
    if (dbStatus !== 'connected') {
      console.log('Database not connected, attempting reconnection...');
      await connectDB();
    }

    // Pass request to Express app
    await app(req, res);

    const duration = Date.now() - startTime;
    console.log(`Request completed in ${duration}ms`);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error('Handler error:', error);
    console.log(`Request failed after ${duration}ms`);

    // Don't send error if response already started
    if (res.headersSent) {
      return;
    }

    // Send appropriate error response
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal server error';

    res.status(statusCode).json({
      success: false,
      message,
      code: error.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && {
        error: String(error),
        stack: error.stack,
      }),
    });
  }
};

export default handler;