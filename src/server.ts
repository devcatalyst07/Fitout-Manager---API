// VERCEL SERVER
import dotenv from 'dotenv';
dotenv.config();

import { Request, Response } from 'express';
import app from './app';
import { connectDB } from './config/database';
import { createAdmin } from './seed/createAdmin';
import { getAllowedOrigins } from './config/security';

let isConnected = false;

const handler = async (req: Request, res: Response) => {
  try {
    // Set CORS headers BEFORE any other processing
    const origin = req.headers.origin;
    const allowedOrigins = getAllowedOrigins();
    
    console.log('📍 Request origin:', origin);
    console.log('Allowed origins:', allowedOrigins);

    // Check if origin is allowed
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token,Cookie');
      res.setHeader('Access-Control-Expose-Headers', 'X-CSRF-Token,Set-Cookie');
      res.setHeader('Access-Control-Max-Age', '86400');
      console.log('CORS headers set for origin:', origin);
    } else if (origin) {
      console.error('❌ CORS blocked - Origin not allowed:', origin);
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      console.log('Handling preflight request');
      res.status(204).end();
      return;
    }

    // Connect to database
    if (!isConnected) {
      console.log('🔌 Connecting to database...');
      await connectDB();
      await createAdmin();
      isConnected = true;
      console.log('Database connected');
    }

    // Pass to Express app
    return app(req, res);
  } catch (error) {
    console.error('Vercel handler error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined
    });
  }
};

export default handler;