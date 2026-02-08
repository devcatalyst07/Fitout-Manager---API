export const securityConfig = {
  // JWT Configuration
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    accessExpiry: process.env.ACCESS_TOKEN_EXPIRY || '15m',
    refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  },

  // Cookie Configuration
  cookie: {
    sessionName: process.env.SESSION_COOKIE_NAME || 'fitout_session',
    refreshName: process.env.REFRESH_COOKIE_NAME || 'fitout_refresh',
    domain: process.env.COOKIE_DOMAIN || 'localhost',
    secure: process.env.NODE_ENV === 'production',
    sameSite: (process.env.COOKIE_SAME_SITE || 'lax') as 'strict' | 'lax' | 'none',
    httpOnly: true,
    maxAge: {
      access: 15 * 60 * 1000, // 15 minutes
      refresh: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  },

  // CORS Configuration
  cors: {
    origin:
      process.env.NODE_ENV === 'production'
        ? [
            process.env.PROD_FRONTEND_URL!,
            'https://fitout-manager-mockup.vercel.app',
          ]
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'X-Requested-With',
    ],
    exposedHeaders: ['X-CSRF-Token'],
    maxAge: 86400, // 24 hours
  },

  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  },

  // CSRF Configuration
  csrf: {
    secret: process.env.CSRF_SECRET!,
    cookieName: 'fitout_csrf',
    headerName: 'X-CSRF-Token',
  },
};

// Validation
if (!securityConfig.jwt.accessSecret || securityConfig.jwt.accessSecret.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be at least 32 characters long');
}

if (!securityConfig.jwt.refreshSecret || securityConfig.jwt.refreshSecret.length < 32) {
  throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long');
}

if (!securityConfig.csrf.secret || securityConfig.csrf.secret.length < 32) {
  throw new Error('CSRF_SECRET must be at least 32 characters long');
}