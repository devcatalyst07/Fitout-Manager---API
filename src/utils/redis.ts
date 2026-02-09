import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;

/**
 * Initialize Redis client
 */
export const initRedis = async (): Promise<void> => {
  try {
    // Skip Redis if not configured
    if (!process.env.REDIS_URL) {
      console.log('⚠️ Redis not configured - caching disabled');
      return;
    }

    redisClient = createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD,
    });

    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected');
    });

    await redisClient.connect();
  } catch (error) {
    console.error('Failed to initialize Redis:', error);
    redisClient = null;
  }
};

/**
 * Get Redis client instance
 */
export const getRedisClient = (): RedisClient | null => {
  return redisClient;
};

/**
 * Cache instance (alias for getRedisClient)
 */
export const cache = getRedisClient;

/**
 * Session store instance (alias for getRedisClient)
 */
export const sessionStore = getRedisClient;

/**
 * Close Redis connection
 */
export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
};