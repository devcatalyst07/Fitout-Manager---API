import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Brand from '../models/Brand';

const router = Router();

// GET all brands
router.get('/', authMiddleware, async (req, res) => {
  try {
    const brands = await Brand.find({ isActive: true })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.json(brands);
  } catch (error) {
    console.error('Get brands error:', error);
    res.status(500).json({ message: 'Failed to fetch brands' });
  }
});

// GET all brands (including inactive - admin only)
router.get('/all', authMiddleware, adminOnly, async (req, res) => {
  try {
    const brands = await Brand.find()
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.json(brands);
  } catch (error) {
    console.error('Get all brands error:', error);
    res.status(500).json({ message: 'Failed to fetch brands' });
  }
});

// CREATE new brand (Admin only)
router.post('/', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Brand name is required' });
    }

    // Check if brand already exists
    const existingBrand = await Brand.findOne({ name });
    if (existingBrand) {
      return res.status(400).json({ message: 'Brand already exists' });
    }

    const newBrand = await Brand.create({
      name,
      description,
      createdBy: req.user.id,
    });

    const populatedBrand = await Brand.findById(newBrand._id)
      .populate('createdBy', 'name email');

    res.status(201).json({
      message: 'Brand created successfully',
      brand: populatedBrand,
    });
  } catch (error) {
    console.error('Create brand error:', error);
    res.status(500).json({ message: 'Failed to create brand' });
  }
});

// UPDATE brand (Admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Brand name is required' });
    }

    // Check if another brand with same name exists
    const existingBrand = await Brand.findOne({ name, _id: { $ne: id } });
    if (existingBrand) {
      return res.status(400).json({ message: 'Brand name already exists' });
    }

    const updatedBrand = await Brand.findByIdAndUpdate(
      id,
      { name, description, isActive },
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!updatedBrand) {
      return res.status(404).json({ message: 'Brand not found' });
    }

    res.json({
      message: 'Brand updated successfully',
      brand: updatedBrand,
    });
  } catch (error) {
    console.error('Update brand error:', error);
    res.status(500).json({ message: 'Failed to update brand' });
  }
});

// DELETE brand (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const deletedBrand = await Brand.findByIdAndDelete(id);

    if (!deletedBrand) {
      return res.status(404).json({ message: 'Brand not found' });
    }

    res.json({ message: 'Brand deleted successfully' });
  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).json({ message: 'Failed to delete brand' });
  }
});

export default router;