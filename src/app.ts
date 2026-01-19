import express from 'express';
import cors from 'cors';
import path from 'path';

import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import dashboardRoutes from './routes/dashboard.routes';
import brandRoutes from './routes/brand.routes';
import projectRoutes from './routes/project.routes';
import documentRoutes from './routes/document.routes';
import taskRoutes from './routes/task.routes';
import budgetRoutes from './routes/budget.routes';
import teamRoutes from './routes/team.routes';
import commentRoutes from "./routes/comment.routes";
import activityLogRoutes from "./routes/activityLog.routes";
import uploadRoutes from "./routes/upload.routes"; 
import overviewRoutes from "./routes/overview.routes";
import approvalRoutes from "./routes/approval.routes";
import insightsRoutes from "./routes/insights.routes";
import activityRoutes from "./routes/activity.routes";

const app = express();

// ============================================
// CORS Configuration (LOCAL + LIVE)
// ============================================

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://fitoutmanager.vercel.app',
  'https://fitout-manager.vercel.app',
  'https://fitness-manager-mockup.vercel.app'
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true, // Allow cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// ============================================
// Middleware
// ============================================

app.use(express.json());

// Serve static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ============================================
// Root & Health Endpoints
// ============================================

app.get('/', (_, res) => {
  res.json({
    message: 'Fitout Manager API is running',
    status: 'online'
  });
});

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============================================
// API Routes
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', dashboardRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', taskRoutes);
app.use('/api/projects', budgetRoutes);
app.use('/api/projects', teamRoutes);
app.use('/api/projects', overviewRoutes);
app.use('/api/projects', insightsRoutes);
app.use('/api/projects', activityRoutes);
app.use('/api/projects', approvalRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/tasks', commentRoutes);
app.use('/api/tasks', activityLogRoutes);
app.use('/api', uploadRoutes);

// ============================================
// Error Handling
// ============================================

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
