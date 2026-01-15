import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import BudgetItem from '../models/BudgetItem';
import Project from '../models/Projects';

const router = Router();

// GET all budget items for a project (Admin only)
router.get('/:projectId/budget', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Verify project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const budgetItems = await BudgetItem.find({ projectId })
      .populate('createdBy', 'name email')
      .sort({ category: 1, createdAt: -1 });

    // Group by category
    const categories = ['Design', 'Approvals', 'Construction', 'Joinery', 'MEP', 'Fixtures', 'Contingency', 'Misc'];
    
    const groupedBudget = categories.map(category => {
      const items = budgetItems.filter(item => item.category === category);
      const totalSpent = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
      
      return {
        category,
        items,
        totalSpent,
        itemCount: items.length
      };
    });

    res.json(groupedBudget);
  } catch (error: any) {
    console.error('Get budget error:', error);
    res.status(500).json({ message: 'Failed to fetch budget', error: error.message });
  }
});

// GET budget summary/statistics (Admin only)
router.get('/:projectId/budget/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const budgetItems = await BudgetItem.find({ projectId });
    
    const totalCommitted = budgetItems.reduce((sum, item) => 
      sum + (item.quantity * item.unitCost), 0
    );

    const totalBudget = project.budget;
    const remaining = totalBudget - totalCommitted;
    const percentUsed = totalBudget > 0 ? (totalCommitted / totalBudget) * 100 : 0;

    // Category breakdown
    const categories = ['Design', 'Approvals', 'Construction', 'Joinery', 'MEP', 'Fixtures', 'Contingency', 'Misc'];
    const categoryBreakdown = categories.map(category => {
      const items = budgetItems.filter(item => item.category === category);
      const spent = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
      
      return {
        category,
        spent,
        itemCount: items.length
      };
    });

    res.json({
      totalBudget,
      totalCommitted,
      remaining,
      percentUsed: Math.round(percentUsed * 10) / 10,
      categoryBreakdown
    });
  } catch (error: any) {
    console.error('Get budget stats error:', error);
    res.status(500).json({ message: 'Failed to fetch budget statistics', error: error.message });
  }
});

// CREATE new budget item (Admin only)
router.post('/:projectId/budget', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const {
      description,
      vendor,
      quantity,
      unitCost,
      committedStatus,
      category
    } = req.body;

    // Validate required fields
    if (!description || !vendor || !category) {
      return res.status(400).json({ message: 'Description, vendor, and category are required' });
    }

    // Verify project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const newBudgetItem = await BudgetItem.create({
      description,
      vendor,
      quantity: quantity || 1,
      unitCost: unitCost || 0,
      committedStatus: committedStatus || 'Normal',
      category,
      projectId,
      createdBy: req.user.id,
    });

    // Update project spent amount
    const totalSpent = await BudgetItem.aggregate([
      { $match: { projectId: project._id } },
      { $group: { _id: null, total: { $sum: { $multiply: ['$quantity', '$unitCost'] } } } }
    ]);

    if (totalSpent.length > 0) {
      project.spent = totalSpent[0].total;
      await project.save();
    }

    const populatedItem = await BudgetItem.findById(newBudgetItem._id)
      .populate('createdBy', 'name email');

    res.status(201).json({
      message: 'Budget item created successfully',
      budgetItem: populatedItem,
    });
  } catch (error: any) {
    console.error('Create budget item error:', error);
    res.status(500).json({ message: 'Failed to create budget item', error: error.message });
  }
});

// UPDATE budget item (Admin only)
router.put('/:projectId/budget/:itemId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId, itemId } = req.params;
    const updateData = req.body;

    const updatedItem = await BudgetItem.findByIdAndUpdate(
      itemId,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!updatedItem) {
      return res.status(404).json({ message: 'Budget item not found' });
    }

    // Update project spent amount
    const project = await Project.findById(projectId);
    if (project) {
      const totalSpent = await BudgetItem.aggregate([
        { $match: { projectId: project._id } },
        { $group: { _id: null, total: { $sum: { $multiply: ['$quantity', '$unitCost'] } } } }
      ]);

      if (totalSpent.length > 0) {
        project.spent = totalSpent[0].total;
        await project.save();
      }
    }

    res.json({
      message: 'Budget item updated successfully',
      budgetItem: updatedItem,
    });
  } catch (error: any) {
    console.error('Update budget item error:', error);
    res.status(500).json({ message: 'Failed to update budget item', error: error.message });
  }
});

// DELETE budget item (Admin only)
router.delete('/:projectId/budget/:itemId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId, itemId } = req.params;

    const deletedItem = await BudgetItem.findByIdAndDelete(itemId);

    if (!deletedItem) {
      return res.status(404).json({ message: 'Budget item not found' });
    }

    // Update project spent amount
    const project = await Project.findById(projectId);
    if (project) {
      const totalSpent = await BudgetItem.aggregate([
        { $match: { projectId: project._id } },
        { $group: { _id: null, total: { $sum: { $multiply: ['$quantity', '$unitCost'] } } } }
      ]);

      project.spent = totalSpent.length > 0 ? totalSpent[0].total : 0;
      await project.save();
    }

    res.json({ message: 'Budget item deleted successfully' });
  } catch (error: any) {
    console.error('Delete budget item error:', error);
    res.status(500).json({ message: 'Failed to delete budget item', error: error.message });
  }
});

export default router;