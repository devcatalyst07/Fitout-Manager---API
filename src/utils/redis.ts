import { createClient } from 'redis';

let redisClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Redis connection
 */
export const initRedis = async () => {
  if (!process.env.REDIS_URL) {
    console.log('⚠️  Redis not configured, using in-memory cache');
    return null;
  }

  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD || undefined,
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    return null;
  }
};

/**
 * Get Redis client
 */
export const getRedisClient = () => redisClient;

/**
 * Cache helper functions
 */
export const cache = {
  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    if (!redisClient) return null;

    try {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  },

  /**
   * Set cached value with TTL
   */
  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    if (!redisClient) return false;

    try {
      const serialized = JSON.stringify(value);
      const expiry = ttl || parseInt(process.env.REDIS_TTL || '3600');

      await redisClient.setEx(key, expiry, serialized);
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  },

  /**
   * Delete cached value
   */
  async del(key: string): Promise<boolean> {
    if (!redisClient) return false;

    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  },

  /**
   * Delete keys by pattern
   */
  async delPattern(pattern: string): Promise<boolean> {
    if (!redisClient) return false;

    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Cache delete pattern error:', error);
      return false;
    }
  },

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!redisClient) return false;

    try {
      const result = await redisClient.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  },
};

/**
 * Session management in Redis
 */
export const sessionStore = {
  /**
   * Store session data
   */
  async set(sessionId: string, data: any, ttl: number = 604800): Promise<boolean> {
    return cache.set(`session:${sessionId}`, data, ttl);
  },

  /**
   * Get session data
   */
  async get(sessionId: string): Promise<any> {
    return cache.get(`session:${sessionId}`);
  },

  /**
   * Delete session
   */
  async delete(sessionId: string): Promise<boolean> {
    return cache.del(`session:${sessionId}`);
  },

  /**
   * Delete all user sessions
   */
  async deleteUserSessions(userId: string): Promise<boolean> {
    return cache.delPattern(`session:*:${userId}`);
  },

  /**
   * Store token version for revocation
   */
  async setTokenVersion(userId: string, version: number): Promise<boolean> {
    return cache.set(`token:version:${userId}`, version, 2592000); // 30 days
  },

  /**
   * Get token version
   */
  async getTokenVersion(userId: string): Promise<number | null> {
    return cache.get(`token:version:${userId}`);
  },
};