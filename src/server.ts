import dotenv from 'dotenv';
dotenv.config();

import { Request, Response } from 'express';
import app from './app';
import { connectDB } from './config/database';
import { createAdmin } from './seed/createAdmin';

let isConnected = false;

// Allowed origins
const getAllowedOrigins = (): string[] => {
  const origins = [
    process.env.FRONTEND_URL,
    process.env.PROD_FRONTEND_URL,
    process.env.CORS_ORIGIN,
  ].filter((origin): origin is string => Boolean(origin));

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

    // Set CORS headers if origin is allowed
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

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      console.log('Preflight request');
      res.status(204).end();
      return;
    }

    // Connect to database
    if (!isConnected) {
      console.log('Connecting to database...');
      await connectDB();
      await createAdmin();
      isConnected = true;
      console.log('Database connected');
    }

    // Pass to Express app
    return app(req, res);
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined
    });
  }
};

export default handler;