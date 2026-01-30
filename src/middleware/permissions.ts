// src/middleware/permissions.ts

import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import Role from "../models/Role";

interface Permission {
  id: string;
  label: string;
  checked: boolean;
  children?: Permission[];
}

// Helper to check if permission exists in permission tree
function hasPermission(
  permissionId: string,
  permissions: Permission[],
): boolean {
  const check = (perms: Permission[]): boolean => {
    for (const perm of perms) {
      if (perm.id === permissionId && perm.checked) return true;
      if (perm.children && check(perm.children)) return true;
    }
    return false;
  };
  return check(permissions);
}

// Middleware to check if user has specific permission
export function requirePermission(permissionId: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Admin always has full access
      if (req.user.role === "admin") {
        return next();
      }

      // Get user's role from database
      const role = await Role.findById(req.user.roleId);

      if (!role) {
        return res.status(403).json({ message: "Role not found" });
      }

      // Check if user has the required permission
      if (hasPermission(permissionId, role.permissions)) {
        return next();
      }

      // User doesn't have permission
      return res.status(403).json({
        message: `Permission denied: ${permissionId} required`,
        requiredPermission: permissionId,
      });
    } catch (error) {
      console.error("Permission check error:", error);
      return res.status(500).json({ message: "Permission check failed" });
    }
  };
}

// Middleware to check if user is project member (for viewing)
export async function requireProjectAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const { projectId } = req.params;

    // Admin always has access
    if (req.user.role === "admin") {
      return next();
    }

    // Check if user is a team member
    const TeamMember = require("../models/TeamMember").default;
    const teamMember = await TeamMember.findOne({
      userId: req.user.id,
      projectId: projectId,
      status: "active",
    });

    if (teamMember) {
      return next();
    }

    return res.status(403).json({ message: "Not a project member" });
  } catch (error) {
    console.error("Project access check error:", error);
    return res.status(500).json({ message: "Access check failed" });
  }
}