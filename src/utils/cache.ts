import { getRedisClient } from './redis';

export interface CachedUser {
  id: string;
  email: string;
  role: string;
  name: string;
  roleId?: string;
}

const CACHE_PREFIX = 'user:';
const CACHE_TTL = 3600; // 1 hour in seconds

/**
 * Cache user data in Redis
 */
export const cacheUser = async (userId: string, userData: CachedUser): Promise<void> => {
  try {
    const redis = getRedisClient();
    if (!redis) {
      console.log('Redis not available, skipping cache');
      return;
    }

    const key = `${CACHE_PREFIX}${userId}`;
    await redis.setEx(key, CACHE_TTL, JSON.stringify(userData));
    console.log(`User cached: ${userId}`);
  } catch (error) {
    console.error('Cache user error:', error);
    // Don't throw - caching is optional
  }
};

/**
 * Get cached user data from Redis
 */
export const getCachedUser = async (userId: string): Promise<CachedUser | null> => {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return null;
    }

    const key = `${CACHE_PREFIX}${userId}`;
    const data = await redis.get(key);
    
    if (!data) {
      return null;
    }

    console.log(`User cache hit: ${userId}`);
    return JSON.parse(data);
  } catch (error) {
    console.error('Get cached user error:', error);
    return null;
  }
};

/**
 * Invalidate (delete) user cache
 */
export const invalidateUserCache = async (userId: string): Promise<void> => {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return;
    }

    const key = `${CACHE_PREFIX}${userId}`;
    await redis.del(key);
    console.log(`User cache invalidated: ${userId}`);
  } catch (error) {
    console.error('Invalidate user cache error:', error);
    // Don't throw - caching is optional
  }
};

/**
 * Invalidate cache by pattern
 */
export const invalidateCache = async (pattern: string): Promise<void> => {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return;
    }

    const keys = await redis.keys(`cache:${pattern}*`);
    if (keys.length > 0) {
      await redis.del(keys);
      console.log(`Cache invalidated: ${keys.length} keys`);
    }
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
};