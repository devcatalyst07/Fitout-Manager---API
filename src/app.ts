import express from "express";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import projectRoutes from "./routes/project.routes";
import documentRoutes from "./routes/document.routes";
import financeRoutes from './routes/finance.routes';
import reportsRoutes from './routes/reports.routes'; 
import threadRoutes from './routes/thread.routes';
import taskRoutes from "./routes/task.routes";
import budgetRoutes from "./routes/budget.routes";
import teamRoutes from "./routes/team.routes";
import commentRoutes from "./routes/comment.routes";
import activityLogRoutes from "./routes/activityLog.routes";
import uploadRoutes from "./routes/upload.routes";
import overviewRoutes from "./routes/overview.routes";
import approvalRoutes from "./routes/approval.routes";
import insightsRoutes from "./routes/insights.routes";
import activityRoutes from "./routes/activity.routes";
import calendarRoutes from "./routes/calendarRoutes";
import dashboardRoutes from './routes/dashboard.routes';
import brandRoutes from './routes/brand.routes';
import roleRoutes from "./routes/role.routes";
import scopeRoutes from "./routes/scope.routes"; // NEW: Scope routes

const app = express();

// CORS Configuration
app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging Middleware (All environments for debugging)
app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path}`);
  next();
});

// Static Files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Health Check
app.get("/health", (_, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Root Route
app.get("/", (_, res) => {
  res.json({
    message: "Fitout Manager API is running",
    status: "online",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth/login",
      admin: "/api/admin/dashboard",
      projects: "/api/projects",
      documents: "/api/documents",
      tasks: "/api/projects/:projectId/tasks",
      budget: "/api/projects/:projectId/budget",
      team: "/api/projects/:projectId/team",
      finance: "/api/finance",
      brands: "/api/brands",
      threads: "/api/brands/:brandId/threads",
      scopes: "/api/scopes", // NEW
    },
  });
});

// API Routes - ORDER MATTERS!
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use('/api/admin', dashboardRoutes);

// Brand, Thread, and Scope routes BEFORE project routes to avoid conflicts
app.use("/api/brands", brandRoutes);
app.use('/api', threadRoutes); // Handles /api/brands/:brandId/threads
app.use("/api/scopes", scopeRoutes); // NEW: Scope and Workflow Architecture
app.use("/api/roles", roleRoutes); // Role management routes

app.use("/api/projects", projectRoutes);
app.use("/api/projects", taskRoutes);
app.use("/api/projects", budgetRoutes);
app.use("/api/projects", teamRoutes);
app.use("/api/projects", overviewRoutes); 
app.use("/api/projects", insightsRoutes); 
app.use("/api/projects", activityRoutes);
app.use("/api/projects", approvalRoutes);

app.use('/api/finance', financeRoutes);
app.use('/api/admin', reportsRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/tasks", commentRoutes);
app.use("/api/tasks", activityLogRoutes);
app.use("/api", uploadRoutes);
app.use("/api", calendarRoutes);

// 404 Handler
app.use((req, res) => {
  console.log(`404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    message: "Route not found",
    path: req.path,
    method: req.method,
    hint: "Check if the route is registered and the URL is correct"
  });
});

// Error Handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("Error:", err);
    res.status(err.status || 500).json({
      message: err.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  },
);

export default app;