import express from 'express';
import Project from '../models/Projects';
import TeamMember from '../models/TeamMember';
import Role from '../models/Role';

export const requireProjectAccess = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> => {
  try {
    const { projectId } = req.params;
    const user = req.user;

    if (!user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    if (user.role === 'admin') {
      next();
      return;
    }

    const teamMember = await TeamMember.findOne({
      userId: user.id,
      projectId,
      status: 'active',
    });

    if (!teamMember) {
      res.status(403).json({
        message: 'You do not have access to this project',
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Project access check error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const requirePermission = (permission: string) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
    try {
      const user = req.user;

      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      if (user.role === 'admin') {
        next();
        return;
      }

      if (!user.roleId) {
        res.status(403).json({
          message: 'No role assigned',
        });
        return;
      }

      const role = await Role.findById(user.roleId);

      if (!role) {
        res.status(403).json({
          message: 'Role not found',
        });
        return;
      }

      const hasPermission = role.permissions.some(
        (p: any) => p.key === permission && p.enabled
      );

      if (!hasPermission) {
        res.status(403).json({
          message: 'You do not have permission to perform this action',
          requiredPermission: permission,
        });
        return;
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
};

export const requireAdmin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const user = req.user;

  if (!user) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  if (user.role !== 'admin') {
    res.status(403).json({
      message: 'Admin access required',
    });
    return;
  }

  next();
};

export const adminOnly = requireAdmin;