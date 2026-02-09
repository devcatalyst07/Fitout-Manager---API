const getAllowedOrigins = (): string[] => {
  const origins = [
    process.env.FRONTEND_URL,
    process.env.PROD_FRONTEND_URL,
    process.env.CORS_ORIGIN,
  ].filter((origin): origin is string => Boolean(origin)); // Remove undefined values

  // Always include production URL as fallback
  const productionUrl = 'https://fitout-manager-mockup.vercel.app';
  if (!origins.includes(productionUrl)) {
    origins.push(productionUrl);
  }

  // Add localhost for development
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }

  // Log origins for debugging
  console.log('🌐 Allowed CORS origins:', origins);
  
  return origins;
};

/**
 * Determine if we should use secure cookies
 */
const isSecure = (): boolean => {
  return process.env.NODE_ENV === 'production' || 
         process.env.COOKIE_SECURE === 'true';
};

/**
 * Get cookie domain based on environment
 */
const getCookieDomain = (): string | undefined => {
  // In production on Vercel, don't set domain to allow same-site cookies
  if (process.env.NODE_ENV === 'production') {
    return undefined; // Let browser handle it
  }
  
  // For local development
  return process.env.COOKIE_DOMAIN || undefined;
};

/**
 * Determine SameSite cookie setting
 */
const getSameSite = (): 'strict' | 'lax' | 'none' => {
  // Use environment variable if set
  if (process.env.COOKIE_SAME_SITE) {
    return process.env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none';
  }
  
  // In production with credentials, use 'none' for cross-site
  // In development, use 'lax'
  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
};

export const securityConfig = {
  /**
   * JWT Configuration
   */
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-CHANGE-IN-PRODUCTION',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-CHANGE-IN-PRODUCTION',
    accessExpiry: process.env.ACCESS_TOKEN_EXPIRY || '15m',
    refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  },

  /**
   * CORS Configuration
   */
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowedOrigins = getAllowedOrigins();
      
      // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error('❌ CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'Cookie',
    ],
    exposedHeaders: ['X-CSRF-Token', 'Set-Cookie'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
  },

  /**
   * Cookie Configuration
   */
  cookies: {
    session: {
      name: process.env.SESSION_COOKIE_NAME || 'fitout_session',
      httpOnly: true,
      secure: isSecure(),
      sameSite: getSameSite(),
      maxAge: 15 * 60 * 1000, // 15 minutes
      domain: getCookieDomain(),
    },
    refresh: {
      name: process.env.REFRESH_COOKIE_NAME || 'fitout_refresh',
      httpOnly: true,
      secure: isSecure(),
      sameSite: getSameSite(),
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      domain: getCookieDomain(),
      path: '/api/auth',
    },
  },

  /**
   * CSRF Configuration
   */
  csrf: {
    secret: process.env.CSRF_SECRET || 'dev-csrf-secret-CHANGE-IN-PRODUCTION',
    enabled: process.env.CSRF_ENABLED === 'true',
  },

  /**
   * Rate Limiting Configuration
   */
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Max 100 requests per windowMs
    authMax: 5, // Max 5 auth attempts per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  },

  /**
   * Session Configuration
   */
  session: {
    maxAge: 15 * 60 * 1000, // 15 minutes
    refreshThreshold: 5 * 60 * 1000, // 5 minutes
    absoluteTimeout: 24 * 60 * 60 * 1000, // 24 hours
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
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  },
};

// Log configuration on startup (only non-sensitive info)
console.log('🔒 Security Configuration Loaded:');
console.log('   - Environment:', process.env.NODE_ENV || 'development');
console.log('   - CSRF Enabled:', securityConfig.csrf.enabled);
console.log('   - Secure Cookies:', isSecure());
console.log('   - SameSite:', getSameSite());
console.log('   - Cookie Domain:', getCookieDomain() || 'none (browser default)');