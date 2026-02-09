export const securityConfig = {
  /**
   * JWT Configuration
   */
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    accessExpiry: process.env.ACCESS_TOKEN_EXPIRY || '15m',
    refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  },

  /**
   * CORS Configuration
   */
  cors: {
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      process.env.PROD_FRONTEND_URL || 'https://fitout-manager-mockup.vercel.app',
      process.env.CORS_ORIGIN || 'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'Cookie',
    ],
    exposedHeaders: ['X-CSRF-Token', 'Set-Cookie'],
    maxAge: 86400,
  },

  /**
   * Cookie Configuration
   */
  cookies: {
    session: {
      name: process.env.SESSION_COOKIE_NAME || 'fitout_session',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: (process.env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none') || 'lax',
      maxAge: 15 * 60 * 1000,
      domain: process.env.COOKIE_DOMAIN || undefined,
    },
    refresh: {
      name: process.env.REFRESH_COOKIE_NAME || 'fitout_refresh',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: (process.env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none') || 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: process.env.COOKIE_DOMAIN || undefined,
      path: '/api/auth',
    },
  },

  /**
   * CSRF Configuration
   */
  csrf: {
    secret: process.env.CSRF_SECRET!,
    enabled: process.env.CSRF_ENABLED === 'true',
  },

  /**
   * Rate Limiting Configuration
   */
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100,
    authMax: 5,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  },

  /**
   * Session Configuration
   */
  session: {
    maxAge: 15 * 60 * 1000,
    refreshThreshold: 5 * 60 * 1000,
    absoluteTimeout: 24 * 60 * 60 * 1000,
  },

  /**
   * Security Headers
   */
  headers: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  },
};