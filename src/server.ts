// // local server
// import dotenv from "dotenv";
// dotenv.config();

// import app from "./app";
// import { connectDB } from "./config/database";
// import { createAdmin } from "./seed/createAdmin";

// const PORT = process.env.PORT || 5000;

// const startServer = async () => {
//   try {
//     // Connect to MongoDB
//     await connectDB();

//     // Create admin after DB connection
//     await createAdmin();

//     // Start server
//     app.listen(PORT, () => {
//       console.log(`Server running on port ${PORT}`);
//     });
//   } catch (error) {
//     console.error("Failed to start server:", error);
//     process.exit(1);
//   }
// };

// startServer();




// vercel server
import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/database';
import { createAdmin } from './seed/createAdmin';

let isConnected = false;

const handler = async (req: any, res: any) => {
  try {
    if (!isConnected) {
      await connectDB();
      await createAdmin();
      isConnected = true;
    }
    return app(req, res);
  } catch (error) {
    console.error('Vercel handler error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export default handler;
