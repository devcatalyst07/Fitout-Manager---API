export const getAllowedOrigins = (): string[] => {
  const origins = [
    process.env.FRONTEND_URL,
    process.env.PROD_FRONTEND_URL,
    process.env.CORS_ORIGIN,
  ].filter((origin): origin is string => Boolean(origin));

  const productionUrl = 'https://fitout-manager-mockup.vercel.app';
  if (!origins.includes(productionUrl)) {
    origins.push(productionUrl);
  }

  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }

  console.log('🌐 Allowed CORS origins:', origins);
  
  return origins;
};

const isSecure = (): boolean => {
  return process.env.NODE_ENV === 'production' || 
         process.env.COOKIE_SECURE === 'true';
};

const getCookieDomain = (): string | undefined => {
  if (process.env.NODE_ENV === 'production') {
    return undefined;
  }
  return process.env.COOKIE_DOMAIN || undefined;
};

const getSameSite = (): 'strict' | 'lax' | 'none' => {
  if (process.env.COOKIE_SAME_SITE) {
    return process.env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none';
  }
  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
};

export const securityConfig = {
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-CHANGE-IN-PRODUCTION',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-CHANGE-IN-PRODUCTION',
    accessExpiry: process.env.ACCESS_TOKEN_EXPIRY || '15m',
    refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  },

  cors: {
    origin: getAllowedOrigins(),
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
    preflightContinue: false,
    optionsSuccessStatus: 204,
  },

  cookies: {
    session: {
      name: process.env.SESSION_COOKIE_NAME || 'fitout_session',
      httpOnly: true,
      secure: isSecure(),
      sameSite: getSameSite(),
      maxAge: 15 * 60 * 1000,
      domain: getCookieDomain(),
    },
    refresh: {
      name: process.env.REFRESH_COOKIE_NAME || 'fitout_refresh',
      httpOnly: true,
      secure: isSecure(),
      sameSite: getSameSite(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: getCookieDomain(),
      path: '/api/auth',
    },
  },

  csrf: {
    secret: process.env.CSRF_SECRET || 'dev-csrf-secret-CHANGE-IN-PRODUCTION',
    enabled: process.env.CSRF_ENABLED === 'true',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100,
    authMax: 5,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  },

  session: {
    maxAge: 15 * 60 * 1000,
    refreshThreshold: 5 * 60 * 1000,
    absoluteTimeout: 24 * 60 * 60 * 1000,
  },

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

console.log('Security Configuration Loaded:');
console.log('   - Environment:', process.env.NODE_ENV || 'development');
console.log('   - CSRF Enabled:', securityConfig.csrf.enabled);
console.log('   - Secure Cookies:', isSecure());
console.log('   - SameSite:', getSameSite());
console.log('   - Cookie Domain:', getCookieDomain() || 'none (browser default)');