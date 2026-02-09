import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../utils/redis';

/**
 * Cache middleware - Cache GET requests
 */
export const cacheMiddleware = (ttl: number = 3600) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const cacheClient = getRedisClient();
    
    // Skip if Redis not available
    if (!cacheClient) {
      return next();
    }

    try {
      const cacheKey = `cache:${req.originalUrl}`;
      const cachedData = await cacheClient.get(cacheKey);

      if (cachedData) {
        console.log(`Cache hit: ${cacheKey}`);
        return res.json(JSON.parse(cachedData));
      }

      // Store original send function
      const originalSend = res.json.bind(res);

      // Override send to cache the response
      res.json = function (data: any) {
        // Cache the response asynchronously
        cacheClient.setEx(cacheKey, ttl, JSON.stringify(data)).catch((err: any) => {
          console.error('Cache set error:', err);
        });

        // Send the response
        return originalSend(data);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
};