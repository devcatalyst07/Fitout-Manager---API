import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import projectRoutes from './routes/project.routes';
import documentRoutes from './routes/document.routes';
import taskRoutes from './routes/task.routes'; // NEW
import budgetRoutes from './routes/budget.routes'; // NEW
import teamRoutes from './routes/team.routes'; // NEW
import commentRoutes from "./routes/comment.routes";
import activityLogRoutes from "./routes/activityLog.routes";
import uploadRoutes from "./routes/upload.routes"; 
import overviewRoutes from "./routes/overview.routes";
import approvalRoutes from "./routes/approval.routes";
import insightsRoutes from "./routes/insights.routes";
import activityRoutes from "./routes/activity.routes";

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Serve static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Root endpoint with more details
app.get('/', (_, res) => {
  res.json({ 
    message: 'Fitout Manager API is running',
    status: 'online',
    endpoints: {
      auth: '/api/auth/login',
      admin: '/api/admin/dashboard',
      projects: '/api/projects',
      documents: '/api/documents',
      tasks: '/api/projects/:projectId/tasks', 
      budget: '/api/projects/:projectId/budget', 
      team: '/api/projects/:projectId/team' 
    }
  });
});

// Health check endpoint
app.get('/health', (_, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', taskRoutes); 
app.use('/api/projects', budgetRoutes); 
app.use('/api/projects', teamRoutes);
app.use("/api/projects", overviewRoutes); // for project overview
app.use("/api/projects", insightsRoutes); // for project insights
app.use("/api/projects", activityRoutes); // for project activity logs
app.use("/api/projects", approvalRoutes); // for approvals
app.use('/api/documents', documentRoutes);
app.use("/api/tasks", commentRoutes);
app.use("/api/tasks", activityLogRoutes);
app.use("/api", uploadRoutes); // for file upoads

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

export default app;