import express from 'express';
import { cache } from '../utils/redis';

export const cacheMiddleware = (ttl: number = 300) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET') {
      return next();
    }

    if (req.user) {
      return next();
    }

    const cacheKey = `cache:${req.originalUrl}`;

    try {
      const cachedData = await cache.get(cacheKey);

      if (cachedData) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cachedData);
      }

      const originalJson = res.json.bind(res);

      res.json = function (data: any) {
        cache.set(cacheKey, data, ttl).catch((err) => {
          console.error('Cache set error:', err);
        });

        res.setHeader('X-Cache', 'MISS');
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
};

export const invalidateCache = async (pattern: string) => {
  try {
    await cache.delPattern(`cache:${pattern}`);
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
};

export const browserCache = (maxAge: number = 3600) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
      res.setHeader('Expires', new Date(Date.now() + maxAge * 1000).toUTCString());
    }
    next();
  };
};