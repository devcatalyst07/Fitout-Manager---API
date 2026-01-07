import dotenv from 'dotenv';
dotenv.config();

import app from './app';

/**
 * Vercel Serverless Entry Point
 * 
 * Do NOT use app.listen()
 * Do NOT define PORT
 * 
 * Vercel will handle the server automatically
 */
export default app;
