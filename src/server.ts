import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { createAdmin } from './seed/createAdmin';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Run seed
    await createAdmin();
    console.log('✅ Admin created/checked');

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server', err);
    process.exit(1);
  }
};

// Start everything
startServer();
