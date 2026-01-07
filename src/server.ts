import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { createAdmin } from './seed/createAdmin';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await createAdmin();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
};

startServer();
