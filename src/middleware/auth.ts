// import { Request, Response, NextFunction } from 'express';
// import jwt from 'jsonwebtoken';

// export interface AuthRequest extends Request {
//   user?: any;
// }

// export const authMiddleware = (
//   req: AuthRequest,
//   res: Response,
//   next: NextFunction
// ) => {
//   const authHeader = req.headers.authorization;

//   if (!authHeader?.startsWith('Bearer ')) {
//     return res.status(401).json({ message: 'Unauthorized' });
//   }

//   const token = authHeader.split(' ')[1];

//   try {
//     const decoded = jwt.verify(
//       token,
//       process.env.JWT_SECRET as string
//     );
//     req.user = decoded;
//     next();
//   } catch {
//     return res.status(401).json({ message: 'Invalid token' });
//   }
// };

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: any;
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  // DEBUG logs — para makita sa Vercel what's happening
  console.log("[AUTH] Authorization header present:", !!authHeader);
  console.log("[AUTH] JWT_SECRET defined:", !!process.env.JWT_SECRET);
  console.log("[AUTH] JWT_SECRET length:", process.env.JWT_SECRET?.length || 0);

  if (!authHeader?.startsWith("Bearer ")) {
    console.log("[AUTH] BLOCKED: No Bearer token in header");
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  console.log("[AUTH] Token length:", token?.length || 0);
  console.log("[AUTH] Token first 20 chars:", token?.substring(0, 20));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
    console.log("[AUTH] Token verified OK, user id:", (decoded as any).id);
    req.user = decoded;
    next();
  } catch (err: any) {
    console.log("[AUTH] Verify FAILED:", err.message);
    console.log("[AUTH] Error name:", err.name);
    return res.status(401).json({ message: "Invalid token" });
  }
};