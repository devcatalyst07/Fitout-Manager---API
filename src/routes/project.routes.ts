import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Project from '../models/Projects';
import User from '../models/User';

const router = Router();

// GET all projects (Admin only)
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const projects = await Project.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    res.json(projects);
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ message: 'Failed to fetch projects' });
  }
});

// GET single project by ID (Admin only) - NEW
router.get('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('userId', 'name email');
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    
    res.json(project);
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ message: 'Failed to fetch project' });
  }
});

// GET project statistics (Admin only)
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const totalProjects = await Project.countDocuments();
    const activeProjects = await Project.countDocuments({ status: 'In Progress' });
    const completedProjects = await Project.countDocuments({ status: 'Completed' });
    const planningProjects = await Project.countDocuments({ status: 'Planning' });

    res.json({
      total: totalProjects,
      active: activeProjects,
      completed: completedProjects,
      planning: planningProjects,
    });
  } catch (error) {
    console.error('Get project stats error:', error);
    res.status(500).json({ message: 'Failed to fetch project statistics' });
  }
});

// CREATE new project (Admin only)
router.post('/', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const {
      projectName,
      brand,
      scope,
      workflow,
      projectCode,
      description,
      location,
      startDate,
      endDate,
      budget,
    } = req.body;

    // Validate required fields
    if (!projectName || !brand || !scope || !workflow) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const newProject = await Project.create({
      projectName,
      brand,
      scope,
      workflow,
      projectCode,
      description,
      location,
      startDate,
      endDate,
      budget: budget || 0,
      spent: 0,
      status: 'Planning',
      userId: req.user.id,
      createdBy: 'admin',
    });

    const populatedProject = await Project.findById(newProject._id).populate('userId', 'name email');

    res.status(201).json({
      message: 'Project created successfully',
      project: populatedProject,
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ message: 'Failed to create project' });
  }
});

// UPDATE project (Admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const updatedProject = await Project.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('userId', 'name email');

    if (!updatedProject) {
      return res.status(404).json({ message: 'Project not found' });
    }

    res.json({
      message: 'Project updated successfully',
      project: updatedProject,
    });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ message: 'Failed to update project' });
  }
});

// DELETE project (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const deletedProject = await Project.findByIdAndDelete(id);

    if (!deletedProject) {
      return res.status(404).json({ message: 'Project not found' });
    }

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ message: 'Failed to delete project' });
  }
});

export default router;