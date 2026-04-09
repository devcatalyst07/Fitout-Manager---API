import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import { connectDB } from "./config/database";
import { createAdmin } from "./seed/createAdmin";
import { addMessagesPermissionToExistingRoles } from "./seed/addMessagesPermission";
import { startReminderCron } from "./services/reminderService";
import { initSocketIO } from "./services/socketService";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    console.log("🚀 Starting Fitout Manager API Server...");

    // Connect to database
    console.log("📡 Connecting to MongoDB...");
    await connectDB();
    console.log("✅ MongoDB connected");

    // Create admin user
    console.log("👤 Setting up admin user...");
    await createAdmin();
    console.log("✅ Admin user ready");

    // Add messages permission to existing roles
    console.log("🔧 Updating role permissions...");
    await addMessagesPermissionToExistingRoles();
    console.log("✅ Role permissions updated");

    // Start reminder cron job
    console.log("⏰ Starting reminder cron job...");
    startReminderCron();
    console.log("✅ Reminder cron started");

    // Create HTTP server and attach Socket.IO
    const httpServer = http.createServer(app);
    console.log("🔌 Initializing Socket.IO...");
    initSocketIO(httpServer);
    console.log("✅ Socket.IO initialized");

    // Start server
    httpServer.listen(PORT, () => {
      console.log("\n=================================");
      console.log(`✅ Server is running on port ${PORT}`);
      console.log(`📍 API URL: http://localhost:${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "production"}`);
      console.log("=================================\n");
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("SIGTERM signal received: closing HTTP server");
      httpServer.close(() => {
        console.log("HTTP server closed");
        process.exit(0);
      });
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    console.error("Stack trace:", (error as Error).stack);
    process.exit(1);
  }
};

startServer();
