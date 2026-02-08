import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { securityConfig } from './config/security';
import {
  securityHeaders,
  customSecurityHeaders,
  rateLimiter,
} from './middleware/security';
import { verifyCsrf, setCsrfToken } from './middleware/csrf';
import { initRedis } from './utils/redis';

// Import routes
import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import projectRoutes from './routes/project.routes';
import documentRoutes from './routes/document.routes';
import financeRoutes from './routes/finance.routes';
import reportsRoutes from './routes/reports.routes';
import threadRoutes from './routes/thread.routes';
import taskRoutes from './routes/task.routes';
import budgetRoutes from './routes/budget.routes';
import teamRoutes from './routes/team.routes';
import commentRoutes from './routes/comment.routes';
import activityLogRoutes from './routes/activityLog.routes';
import uploadRoutes from './routes/upload.routes';
import overviewRoutes from './routes/overview.routes';
import approvalRoutes from './routes/approval.routes';
import insightsRoutes from './routes/insights.routes';
import activityRoutes from './routes/activity.routes';
import calendarRoutes from './routes/calendarRoutes';
import dashboardRoutes from './routes/dashboard.routes';
import brandRoutes from './routes/brand.routes';
import roleRoutes from './routes/role.routes';
import scopeRoutes from './routes/scope.routes';
import profileRoutes from './routes/profile.routes';

const app = express();

// Initialize Redis (optional)
initRedis().catch((err) => {
  console.error('Redis initialization failed:', err);
});

// Trust proxy (required for Vercel)
app.set('trust proxy', 1);

// Security headers
app.use(securityHeaders);
app.use(customSecurityHeaders);

// CORS configuration
app.use(cors(securityConfig.cors));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser());

// Rate limiting
app.use(rateLimiter);

// Logging middleware
app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path}`);
  next();
});

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check (no auth required)
app.get('/health', (_, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  });
});

// Root route
app.get('/', (_, res) => {
  res.json({
    message: 'Fitout Manager API is running',
    status: 'online',
    version: '2.0.0',
    security: 'enhanced',
  });
});

// CSRF token generation for authenticated routes
app.use('/api', setCsrfToken);

// CSRF verification for state-changing requests
app.use('/api', verifyCsrf);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', dashboardRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api', threadRoutes);
app.use('/api/scopes', scopeRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', taskRoutes);
app.use('/api/projects', budgetRoutes);
app.use('/api/projects', teamRoutes);
app.use('/api/projects', overviewRoutes);
app.use('/api/projects', insightsRoutes);
app.use('/api/projects', activityRoutes);
app.use('/api/projects', approvalRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/admin', reportsRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/tasks', commentRoutes);
app.use('/api/tasks', activityLogRoutes);
app.use('/api', uploadRoutes);
app.use('/api', calendarRoutes);
app.use('/api/profile', profileRoutes);

// 404 Handler
app.use((req, res) => {
  console.log(`404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({
    message: 'Route not found',
    path: req.path,
    method: req.method,
  });
});

// Error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
      message: err.message || 'Internal server error',
      code: err.code || 'SERVER_ERROR',
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
);

export default app;