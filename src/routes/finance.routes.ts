import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminOnly } from '../middleware/role';
import Project from '../models/Projects';
import BudgetItem from '../models/BudgetItem';
import Brand from '../models/Brand';
import Approval from '../models/Approval';

const router = Router();

// GET finance overview/statistics
router.get('/finance', authMiddleware, adminOnly, async (req, res) => {
  try {
    console.log('Finance overview requested'); // ADD LOGGING
    const { brand, region } = req.query;
    console.log('Filters:', { brand, region }); // ADD LOGGING

    // Build filter query
    let projectFilter: any = {};
    if (brand && brand !== 'All') {
      projectFilter.brand = brand;
    }
    if (region && region !== 'All') {
      projectFilter.region = region;
    }

    // Get filtered projects!
    const projects = await Project.find(projectFilter).populate('userId', 'name email');
    console.log('Projects found:', projects.length); // ADD LOGGING

    // Get all budget items for these projects
    const projectIds = projects.map(p => p._id);
    const budgetItems = await BudgetItem.find({ projectId: { $in: projectIds } });
    console.log('Budget items found:', budgetItems.length); // ADD LOGGING

    // Get pending approvals
    const pendingApprovals = await Approval.find({ 
      status: 'pending',
      projectId: { $in: projectIds }
    })
      .populate('projectId', 'projectName')
      .limit(5);

    // Calculate portfolio totals
    const totalBudget = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
    
    // Calculate committed (all statuses except Planned)
    const totalCommitted = budgetItems
      .filter(b => b.committedStatus !== 'Planned')
      .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);

    // Calculate by status
    const totalInvoiced = budgetItems
      .filter(b => b.committedStatus === 'Invoiced' || b.committedStatus === 'Paid')
      .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);

    const totalPaid = budgetItems
      .filter(b => b.committedStatus === 'Paid')
      .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);

    // Calculate accruals (Committed but not yet invoiced)
    const totalAccruals = budgetItems
      .filter(b => b.committedStatus === 'Committed')
      .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);

    // Calculate headroom (Budget - Committed)
    const totalHeadroom = totalBudget - totalCommitted;

    // Calculate EAC (Estimate at Completion) using default 85% factor
    const defaultEACFactor = 0.85;
    const totalEAC = budgetItems.reduce((sum, b) => {
      if (b.committedStatus === 'Paid' || b.committedStatus === 'Invoiced') {
        return sum + (b.quantity * b.unitCost);
      } else if (b.committedStatus === 'Committed') {
        return sum + (b.quantity * b.unitCost);
      } else {
        // Planned items: apply factor to remaining budget
        return sum + (b.quantity * b.unitCost * defaultEACFactor);
      }
    }, 0);

    // Calculate variance (Budget - EAC)
    const totalVariance = totalBudget - totalEAC;

    // Calculate utilisation percentage
    const totalUtilisation = totalBudget > 0 ? (totalCommitted / totalBudget) * 100 : 0;

    // Count projects at risk (utilisation > 90% or variance < 0)
    const projectsAtRisk = projects.filter(p => {
      const projectBudgetItems = budgetItems.filter(b => 
        b.projectId.toString() === p._id.toString()
      );
      const projectCommitted = projectBudgetItems
        .filter(b => b.committedStatus !== 'Planned')
        .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);
      
      const utilisation = p.budget > 0 ? (projectCommitted / p.budget) * 100 : 0;
      
      const projectEAC = projectBudgetItems.reduce((sum, b) => {
        if (b.committedStatus === 'Paid' || b.committedStatus === 'Invoiced' || b.committedStatus === 'Committed') {
          return sum + (b.quantity * b.unitCost);
        } else {
          return sum + (b.quantity * b.unitCost * defaultEACFactor);
        }
      }, 0);
      
      const variance = p.budget - projectEAC;
      
      return utilisation > 90 || variance < 0;
    }).length;

    // Calculate percentage change for committed (comparing to last month)
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthBudgetItems = budgetItems.filter(b => 
      new Date(b.createdAt) < lastMonth
    );
    const lastMonthCommitted = lastMonthBudgetItems
      .filter(b => b.committedStatus !== 'Planned')
      .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);
    
    const committedChange = lastMonthCommitted > 0 
      ? ((totalCommitted - lastMonthCommitted) / lastMonthCommitted) * 100 
      : 0;

    // Build project details with all calculations
    const projectDetails = projects.map(project => {
      const projectBudgetItems = budgetItems.filter(b => 
        b.projectId.toString() === project._id.toString()
      );

      const committed = projectBudgetItems
        .filter(b => b.committedStatus !== 'Planned')
        .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);

      const invoiced = projectBudgetItems
        .filter(b => b.committedStatus === 'Invoiced' || b.committedStatus === 'Paid')
        .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);

      const paid = projectBudgetItems
        .filter(b => b.committedStatus === 'Paid')
        .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);

      const accruals = projectBudgetItems
        .filter(b => b.committedStatus === 'Committed')
        .reduce((sum, b) => sum + (b.quantity * b.unitCost), 0);

      const headroom = project.budget - committed;

      // EAC calculation with factor
      const eac = projectBudgetItems.reduce((sum, b) => {
        if (b.committedStatus === 'Paid' || b.committedStatus === 'Invoiced' || b.committedStatus === 'Committed') {
          return sum + (b.quantity * b.unitCost);
        } else {
          return sum + (b.quantity * b.unitCost * defaultEACFactor);
        }
      }, 0);

      const variance = project.budget - eac;
      const utilisation = project.budget > 0 ? (committed / project.budget) * 100 : 0;

      return {
        _id: project._id,
        projectName: project.projectName,
        brand: project.brand,
        region: project.region || 'Demo Region',
        budget: project.budget,
        committed,
        invoiced,
        paid,
        accruals,
        headroom,
        eac,
        variance,
        utilisation,
        eacFactor: defaultEACFactor,
      };
    });

    // Get unique brands and regions for filters
    const brands = await Brand.find({ isActive: true }).select('name');
    const regions = [...new Set(projects.map(p => p.region || 'Demo Region'))];

    res.json({
      summary: {
        totalBudget,
        totalCommitted,
        committedChange,
        totalVariance,
        totalUtilisation,
        projectsAtRisk,
      },
      portfolioTotals: {
        budget: totalBudget,
        committed: totalCommitted,
        invoiced: totalInvoiced,
        paid: totalPaid,
        accruals: totalAccruals,
        headroom: totalHeadroom,
        eac: totalEAC,
        variance: totalVariance,
      },
      projects: projectDetails,
      pendingApprovals,
      filters: {
        brands: brands.map(b => b.name),
        regions,
      },
    });
  } catch (error) {
    console.error('Get finance overview error:', error);
    res.status(500).json({ message: 'Failed to fetch finance overview' });
  }
});

// UPDATE project EAC settings
router.put('/finance/projects/:projectId/eac-settings', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { eacPolicyType, eacFactor, manualForecast } = req.body;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Update EAC settings
    project.eacPolicyType = eacPolicyType;
    project.eacFactor = eacFactor;
    project.manualForecast = manualForecast;

    await project.save();

    res.json({
      message: 'EAC settings updated successfully',
      project,
    });
  } catch (error) {
    console.error('Update EAC settings error:', error);
    res.status(500).json({ message: 'Failed to update EAC settings' });
  }
});

export default router;