/**
 * Security Configuration
 * Production-grade settings for authentication, CORS, and session management
 */

export const getAllowedOrigins = (): string[] => {
  const origins: string[] = [];

  // Add configured origins
  if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL);
  if (process.env.PROD_FRONTEND_URL) origins.push(process.env.PROD_FRONTEND_URL);
  if (process.env.CORS_ORIGIN) origins.push(process.env.CORS_ORIGIN);

  // Always include production URL
  const productionUrl = 'https://fitout-manager-mockup.vercel.app';
  if (!origins.includes(productionUrl)) {
    origins.push(productionUrl);
  }

  // Add localhost for development
  if (process.env.NODE_ENV !== 'production') {
    const localhostOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5000',
    ];
    localhostOrigins.forEach(origin => {
      if (!origins.includes(origin)) {
        origins.push(origin);
      }
    });
  }

  // Remove duplicates
  const uniqueOrigins = [...new Set(origins)];
  
  console.log('🌐 Allowed CORS origins:', uniqueOrigins);
  
  return uniqueOrigins;
};

/**
 * Determine if cookies should be secure
 */
const isSecure = (): boolean => {
  // Always true in production
  if (process.env.NODE_ENV === 'production') {
    return true;
  }
  
  // Allow override in development
  return process.env.COOKIE_SECURE === 'true';
};

/**
 * Get cookie domain
 */
const getCookieDomain = (): string | undefined => {
  // In production on Vercel, leave undefined for automatic domain
  if (process.env.NODE_ENV === 'production') {
    return undefined;
  }

  // In development, only set a domain if it's NOT localhost
  const configuredDomain = process.env.COOKIE_DOMAIN;
  if (!configuredDomain) return undefined;

  const lowerDomain = configuredDomain.toLowerCase();
  if (lowerDomain === 'localhost' || lowerDomain === '127.0.0.1') {
    return undefined;
  }

  return configuredDomain;
};

/**
 * Get SameSite setting
 */
const getSameSite = (): 'strict' | 'lax' | 'none' => {
  // Explicit configuration takes precedence
  if (process.env.COOKIE_SAME_SITE) {
    const value = process.env.COOKIE_SAME_SITE.toLowerCase();
    if (['strict', 'lax', 'none'].includes(value)) {
      return value as 'strict' | 'lax' | 'none';
    }
  }
  
  // Production default: 'none' for cross-domain cookies
  if (process.env.NODE_ENV === 'production') {
    return 'none';
  }
  
  // Development default: 'lax' for same-domain cookies
  return 'lax';
};

/**
 * Parse a duration string into milliseconds.
 * Supports: ms, s, m, h, d (e.g., "30m", "7d").
 * Falls back to a plain number (milliseconds).
 */
const parseDurationMs = (value: string, fallbackMs: number): number => {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) return fallbackMs;

  const amount = parseInt(match[1], 10);
  const unit = match[2] || 'ms';

  switch (unit) {
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 's':
      return amount * 1000;
    case 'ms':
    default:
      return amount;
  }
};

/**
 * Get token expiry values
 */
const getTokenExpiry = () => {
  return {
    access: process.env.ACCESS_TOKEN_EXPIRY || '30m',
    refresh: process.env.REFRESH_TOKEN_EXPIRY || '30d',
  };
};

/**
 * Security configuration object
 */
export const securityConfig = {
  // JWT Configuration
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-CHANGE-IN-PRODUCTION',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-CHANGE-IN-PRODUCTION',
    accessExpiry: getTokenExpiry().access,
    refreshExpiry: getTokenExpiry().refresh,
  },

  // CORS Configuration
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowedOrigins = getAllowedOrigins();
      
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }
      
      // Check if origin is allowed
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log('Origin not allowed:', origin);
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
      'X-Requested-With',
    ],
    exposedHeaders: ['X-CSRF-Token', 'Set-Cookie'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
  },

  // Cookie Configuration
  cookies: {
    session: {
      name: process.env.SESSION_COOKIE_NAME || 'fitout_session',
      httpOnly: true,
      secure: isSecure(),
      sameSite: getSameSite(),
      maxAge: parseInt(process.env.SESSION_MAX_AGE || '1800000'), // 30 minutes
      domain: getCookieDomain(),
      path: '/',
    },
    refresh: {
      name: process.env.REFRESH_COOKIE_NAME || 'fitout_refresh',
      httpOnly: true,
      secure: isSecure(),
      sameSite: getSameSite(),
      maxAge: parseDurationMs(process.env.REFRESH_TOKEN_EXPIRY || '30d', 2592000000),
      domain: getCookieDomain(),
      path: '/api/auth',
    },
  },

  // CSRF Configuration
  csrf: {
    secret: process.env.CSRF_SECRET || 'dev-csrf-secret-CHANGE-IN-PRODUCTION',
    enabled: process.env.CSRF_ENABLED === 'true',
  },

  // Rate Limiting Configuration
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    authMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '5'),
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  },

  // Session Configuration
  session: {
    maxAge: parseInt(process.env.SESSION_MAX_AGE || '1800000'), // 30 minutes
    refreshThreshold: parseInt(process.env.SESSION_REFRESH_THRESHOLD || '300000'), // 5 minutes
    absoluteTimeout: parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT || '86400000'), // 24 hours
  },

  // Security Headers Configuration
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

// Log configuration on startup
console.log('═════════════════════════════════════════════');
console.log('Security Configuration Loaded');
console.log('═════════════════════════════════════════════');
console.log('   Environment:', process.env.NODE_ENV || 'development');
console.log('   CSRF Enabled:', securityConfig.csrf.enabled);
console.log('   Secure Cookies:', isSecure());
console.log('   SameSite:', getSameSite());
console.log('   Cookie Domain:', getCookieDomain() || 'auto');
console.log('   Access Token:', getTokenExpiry().access);
console.log('   Refresh Token:', getTokenExpiry().refresh);
console.log('═════════════════════════════════════════════');

export default securityConfig;