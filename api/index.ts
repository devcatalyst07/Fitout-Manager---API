import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from '../src/config/database';
import { createAdmin } from '../src/seed/createAdmin';
import app from '../src/app';

let isConnected = false;

const handler = async (req: any, res: any) => {
  try {
    // Enable CORS for all origins
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Connect to DB only once
    if (!isConnected) {
      console.log('Connecting to MongoDB...');
      await connectDB();
      console.log('MongoDB connected');
      
      console.log('Creating admin...');
      await createAdmin();
      console.log('Admin created/verified');
      
      isConnected = true;
    }

    // Pass to Express app
    return app(req, res);
  } catch (error: any) {
    console.error('Vercel handler error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export default handler;