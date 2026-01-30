import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export const adminOnly = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user.role !== "admin" && req.user.role !== "user") {
    return res.status(403).json({ message: "Unauthorized" });
  }
  next();
};;
