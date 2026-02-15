import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/database';
import { createAdmin } from './seed/createAdmin';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to database
    console.log('🔌 Connecting to database...');
    await connectDB();
    console.log('Database connected');

    // Create admin user
    await createAdmin();

    // Start server
    app.listen(PORT, () => {
      console.log('=================================');
      console.log(`Server is running on port ${PORT}`);
      console.log(`API URL: http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('=================================');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();