import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { createAdmin } from './seed/createAdmin';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await createAdmin();
  console.log('✅ Admin created/checked');
};

// Initialize admin on startup
startServer();

// For Vercel, export the app
export default app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}