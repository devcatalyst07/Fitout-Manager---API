// vercel server
import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/database';
import { createAdmin } from './seed/createAdmin';
import { createDefaultScope } from './seed/createDefaultScope'; // NEW

let isConnected = false;

const handler = async (req: any, res: any) => {
  try {
    if (!isConnected) {
      await connectDB();
      await createAdmin();
      await createDefaultScope(); // NEW: Create default "Standard" scope with "Basic" workflow
      isConnected = true;
    }
    return app(req, res);
  } catch (error) {
    console.error('Vercel handler error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export default handler;