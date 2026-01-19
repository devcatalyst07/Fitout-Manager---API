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

// Get allowed origins from environment variable or use defaults
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://your-frontend.vercel.app' // Replace with your actual frontend URL
];

console.log('CORS enabled for origins:', allowedOrigins);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) {
      console.log('Request with no origin allowed');
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log('CORS allowed for:', origin);
      callback(null, true);
    } else {
      console.log('CORS blocked for:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400 // 24 hours
}));

// Handle preflight OPTIONS requests
app.options('*', cors());

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
      dashboard: '/api/admin/dashboard/stats',
      brands: '/api/brands',
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

// API Routes

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', dashboardRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', taskRoutes); 
app.use('/api/projects', budgetRoutes); 
app.use('/api/projects', teamRoutes);
app.use("/api/projects", overviewRoutes);
app.use("/api/projects", insightsRoutes);
app.use("/api/projects", activityRoutes);
app.use("/api/projects", approvalRoutes);
app.use('/api/documents', documentRoutes);
app.use("/api/tasks", commentRoutes);
app.use("/api/tasks", activityLogRoutes);
app.use("/api", uploadRoutes);


// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Error:', err);
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