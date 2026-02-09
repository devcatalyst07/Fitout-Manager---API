import dotenv from 'dotenv';
dotenv.config();

import { Request, Response } from 'express';
import { connectDB } from '../src/config/database';
import { createAdmin } from '../src/seed/createAdmin';
import app from '../src/app';

let isConnected = false;

// Allowed origins
const getAllowedOrigins = (): string[] => {
  const origins: string[] = [];
  
  if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL);
  if (process.env.PROD_FRONTEND_URL) origins.push(process.env.PROD_FRONTEND_URL);
  if (process.env.CORS_ORIGIN) origins.push(process.env.CORS_ORIGIN);

  // Always include production URL
  const productionUrl = 'https://fitout-manager-mockup.vercel.app';
  if (!origins.includes(productionUrl)) {
    origins.push(productionUrl);
  }

  // Add localhost for development
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }

  return origins;
};

const handler = async (req: Request, res: Response) => {
  try {
    const origin = req.headers.origin;
    const allowedOrigins = getAllowedOrigins();
    
    console.log('Request origin:', origin);
    console.log('Allowed origins:', allowedOrigins);

    // Set CORS headers ONLY if origin is allowed
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token,Cookie');
      res.setHeader('Access-Control-Expose-Headers', 'X-CSRF-Token,Set-Cookie');
      res.setHeader('Access-Control-Max-Age', '86400');
      console.log('CORS headers set for:', origin);
    } else {
      console.log('Origin not in allowed list:', origin);
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      console.log('Preflight request');
      res.status(204).end();
      return;
    }

    // Connect to DB only once
    if (!isConnected) {
      console.log('🔌 Connecting to MongoDB...');
      await connectDB();
      console.log('MongoDB connected');
      
      console.log('Creating admin...');
      await createAdmin();
      console.log('Admin created/verified');
      
      isConnected = true;
    }

    // Pass to Express app
    return app(req, res);
  } catch (error) {
    console.error('❌ Vercel handler error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

export default handler;