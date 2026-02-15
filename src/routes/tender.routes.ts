import express from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireAdmin } from '../middleware/permissions';
import Tender from '../models/Tender';
import TenderBid from '../models/TenderBid';
import TenderRFI from '../models/TenderRFI';
import Contractor from '../models/Contractor';

const router = express.Router();

// ==================== TENDER ROUTES ====================

// GET all tenders for a project
router.get('/projects/:projectId/tenders', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { projectId } = req.params;
    
    const tenders = await Tender.find({ projectId })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    res.json(tenders);
  } catch (error) {
    console.error('Get tenders error:', error);
    res.status(500).json({ message: 'Failed to fetch tenders' });
  }
});

// GET single tender with details
router.get('/tenders/:tenderId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    
    const tender = await Tender.findById(tenderId)
      .populate('createdBy', 'name email');
    
    if (!tender) {
      return res.status(404).json({ message: 'Tender not found' });
    }
    
    // Get bids for this tender
    const bids = await TenderBid.find({ tenderId }).sort({ bidAmount: 1 });
    
    // Get RFIs for this tender
    const rfis = await TenderRFI.find({ tenderId }).sort({ askedAt: -1 });
    
    res.json({
      ...tender.toObject(),
      bids,
      rfis,
    });
  } catch (error) {
    console.error('Get tender error:', error);
    res.status(500).json({ message: 'Failed to fetch tender' });
  }
});

// CREATE tender
router.post('/projects/:projectId/tenders', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { projectId } = req.params;
    const {
      title,
      description,
      category,
      budgetedAmount,
      submissionDeadline,
      scopeOfWorks,
      specifications,
      complianceRequirements,
      shortlistedContractors,
    } = req.body;
    
    if (!title || !budgetedAmount) {
      return res.status(400).json({ message: 'Title and budgeted amount are required' });
    }
    
    const newTender = await Tender.create({
      projectId,
      title,
      description,
      category: category || 'Construction',
      budgetedAmount,
      submissionDeadline,
      scopeOfWorks,
      specifications,
      complianceRequirements: complianceRequirements || [],
      shortlistedContractors: shortlistedContractors || [],
      createdBy: req.user!.id,
    });
    
    const populatedTender = await Tender.findById(newTender._id)
      .populate('createdBy', 'name email');
    
    res.status(201).json({
      message: 'Tender created successfully',
      tender: populatedTender,
    });
  } catch (error) {
    console.error('Create tender error:', error);
    res.status(500).json({ message: 'Failed to create tender' });
  }
});

// UPDATE tender
router.put('/tenders/:tenderId', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    
    const tender = await Tender.findById(tenderId);
    if (!tender) {
      return res.status(404).json({ message: 'Tender not found' });
    }
    
    if (tender.status === 'Awarded') {
      return res.status(400).json({ message: 'Cannot edit awarded tender' });
    }
    
    const updatedTender = await Tender.findByIdAndUpdate(
      tenderId,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');
    
    res.json({
      message: 'Tender updated successfully',
      tender: updatedTender,
    });
  } catch (error) {
    console.error('Update tender error:', error);
    res.status(500).json({ message: 'Failed to update tender' });
  }
});

// ISSUE tender (change status to Issued)
router.post('/tenders/:tenderId/issue', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    
    const tender = await Tender.findById(tenderId);
    if (!tender) {
      return res.status(404).json({ message: 'Tender not found' });
    }
    
    if (tender.status !== 'Draft') {
      return res.status(400).json({ message: 'Only draft tenders can be issued' });
    }
    
    if (!tender.shortlistedContractors || tender.shortlistedContractors.length === 0) {
      return res.status(400).json({ message: 'Please shortlist contractors before issuing tender' });
    }
    
    tender.status = 'Issued';
    tender.issueDate = new Date();
    
    // Set invited dates for contractors
    tender.shortlistedContractors = tender.shortlistedContractors.map((c: any) => ({
      ...c,
      invitedAt: new Date(),
    }));
    
    await tender.save();
    
    res.json({
      message: 'Tender issued successfully',
      tender,
    });
  } catch (error) {
    console.error('Issue tender error:', error);
    res.status(500).json({ message: 'Failed to issue tender' });
  }
});

// DELETE tender
router.delete('/tenders/:tenderId', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    
    const tender = await Tender.findById(tenderId);
    if (!tender) {
      return res.status(404).json({ message: 'Tender not found' });
    }
    
    if (tender.status !== 'Draft') {
      return res.status(400).json({ message: 'Only draft tenders can be deleted' });
    }
    
    await TenderBid.deleteMany({ tenderId });
    await TenderRFI.deleteMany({ tenderId });
    
    await Tender.findByIdAndDelete(tenderId);
    
    res.json({ message: 'Tender deleted successfully' });
  } catch (error) {
    console.error('Delete tender error:', error);
    res.status(500).json({ message: 'Failed to delete tender' });
  }
});

// ==================== BID ROUTES ====================

// GET bids for a tender
router.get('/tenders/:tenderId/bids', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    
    const bids = await TenderBid.find({ tenderId })
      .populate('reviewedBy', 'name email')
      .sort({ bidAmount: 1 });
    
    res.json(bids);
  } catch (error) {
    console.error('Get bids error:', error);
    res.status(500).json({ message: 'Failed to fetch bids' });
  }
});

// CREATE/UPDATE bid
router.post('/tenders/:tenderId/bids', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const {
      contractorId,
      contractorName,
      contractorEmail,
      bidAmount,
      breakdownItems,
      assumptions,
      exclusions,
      proposedStartDate,
      proposedCompletionDate,
      proposedDuration,
    } = req.body;
    
    if (!bidAmount || !contractorId) {
      return res.status(400).json({ message: 'Bid amount and contractor ID are required' });
    }
    
    let bid = await TenderBid.findOne({ tenderId, contractorId });
    
    if (bid) {
      Object.assign(bid, {
        bidAmount,
        breakdownItems: breakdownItems || [],
        assumptions,
        exclusions,
        proposedStartDate,
        proposedCompletionDate,
        proposedDuration,
      });
      await bid.save();
    } else {
      bid = await TenderBid.create({
        tenderId,
        contractorId,
        contractorName,
        contractorEmail,
        bidAmount,
        breakdownItems: breakdownItems || [],
        assumptions,
        exclusions,
        proposedStartDate,
        proposedCompletionDate,
        proposedDuration,
      });
    }
    
    res.json({
      message: 'Bid saved successfully',
      bid,
    });
  } catch (error) {
    console.error('Save bid error:', error);
    res.status(500).json({ message: 'Failed to save bid' });
  }
});

// SUBMIT bid
router.post('/tenders/:tenderId/bids/:bidId/submit', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { bidId } = req.params;
    
    const bid = await TenderBid.findById(bidId);
    if (!bid) {
      return res.status(404).json({ message: 'Bid not found' });
    }
    
    if (bid.status === 'Submitted') {
      return res.status(400).json({ message: 'Bid already submitted' });
    }
    
    bid.status = 'Submitted';
    bid.submittedAt = new Date();
    await bid.save();
    
    const tender = await Tender.findById(bid.tenderId);
    if (tender && tender.status === 'Issued') {
      tender.status = 'Bid Evaluation';
      await tender.save();
    }
    
    res.json({
      message: 'Bid submitted successfully',
      bid,
    });
  } catch (error) {
    console.error('Submit bid error:', error);
    res.status(500).json({ message: 'Failed to submit bid' });
  }
});

// EVALUATE bid
router.put('/tenders/:tenderId/bids/:bidId/evaluate', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { bidId } = req.params;
    const { evaluationScore, evaluationNotes, status } = req.body;
    
    const bid = await TenderBid.findById(bidId);
    if (!bid) {
      return res.status(404).json({ message: 'Bid not found' });
    }
    
    bid.evaluationScore = evaluationScore;
    bid.evaluationNotes = evaluationNotes;
    bid.status = status || 'Under Review';
    bid.reviewedAt = new Date();
    bid.reviewedBy = req.user!.id;
    
    await bid.save();
    
    res.json({
      message: 'Bid evaluated successfully',
      bid,
    });
  } catch (error) {
    console.error('Evaluate bid error:', error);
    res.status(500).json({ message: 'Failed to evaluate bid' });
  }
});

// AWARD tender
router.post('/tenders/:tenderId/award', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const { bidId, awardedReason } = req.body;
    
    if (!bidId) {
      return res.status(400).json({ message: 'Bid ID is required' });
    }
    
    const tender = await Tender.findById(tenderId);
    if (!tender) {
      return res.status(404).json({ message: 'Tender not found' });
    }
    
    const bid = await TenderBid.findById(bidId);
    if (!bid) {
      return res.status(404).json({ message: 'Bid not found' });
    }
    
    tender.status = 'Awarded';
    tender.awardedContractorId = bid.contractorId;
    tender.awardedAmount = bid.bidAmount;
    tender.awardedReason = awardedReason;
    tender.awardDate = new Date();
    await tender.save();
    
    bid.status = 'Accepted';
    await bid.save();
    
    await TenderBid.updateMany(
      { tenderId, _id: { $ne: bidId } },
      { status: 'Rejected' }
    );
    
    res.json({
      message: 'Tender awarded successfully',
      tender,
    });
  } catch (error) {
    console.error('Award tender error:', error);
    res.status(500).json({ message: 'Failed to award tender' });
  }
});

// ==================== RFI ROUTES ====================

// GET RFIs for a tender
router.get('/tenders/:tenderId/rfis', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    
    const rfis = await TenderRFI.find({ tenderId })
      .populate('answeredBy', 'name email')
      .sort({ askedAt: -1 });
    
    res.json(rfis);
  } catch (error) {
    console.error('Get RFIs error:', error);
    res.status(500).json({ message: 'Failed to fetch RFIs' });
  }
});

// CREATE RFI
router.post('/tenders/:tenderId/rfis', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const { contractorId, contractorName, question } = req.body;
    
    if (!question) {
      return res.status(400).json({ message: 'Question is required' });
    }
    
    const rfi = await TenderRFI.create({
      tenderId,
      contractorId,
      contractorName,
      question,
    });
    
    const tender = await Tender.findById(tenderId);
    if (tender && tender.status === 'Issued') {
      tender.status = 'RFI';
      await tender.save();
    }
    
    res.status(201).json({
      message: 'RFI created successfully',
      rfi,
    });
  } catch (error) {
    console.error('Create RFI error:', error);
    res.status(500).json({ message: 'Failed to create RFI' });
  }
});

// ANSWER RFI
router.put('/rfis/:rfiId/answer', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { rfiId } = req.params;
    const { response } = req.body;
    
    if (!response) {
      return res.status(400).json({ message: 'Response is required' });
    }
    
    const rfi = await TenderRFI.findById(rfiId);
    if (!rfi) {
      return res.status(404).json({ message: 'RFI not found' });
    }
    
    rfi.response = response;
    rfi.status = 'Answered';
    rfi.answeredAt = new Date();
    rfi.answeredBy = req.user!.id;
    await rfi.save();
    
    res.json({
      message: 'RFI answered successfully',
      rfi,
    });
  } catch (error) {
    console.error('Answer RFI error:', error);
    res.status(500).json({ message: 'Failed to answer RFI' });
  }
});

// ==================== CONTRACTOR ROUTES ====================

// GET all contractors
router.get('/contractors', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const contractors = await Contractor.find({ status: { $ne: 'Blacklisted' } })
      .sort({ name: 1 });
    
    res.json(contractors);
  } catch (error) {
    console.error('Get contractors error:', error);
    res.status(500).json({ message: 'Failed to fetch contractors' });
  }
});

// CREATE contractor
router.post('/contractors', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const {
      name,
      email,
      phone,
      companyName,
      companyAddress,
      registrationNumber,
      categories,
      regions,
    } = req.body;
    
    if (!name || !email || !companyName) {
      return res.status(400).json({ message: 'Name, email, and company name are required' });
    }
    
    const existing = await Contractor.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Contractor with this email already exists' });
    }
    
    const contractor = await Contractor.create({
      name,
      email,
      phone,
      companyName,
      companyAddress,
      registrationNumber,
      categories: categories || [],
      regions: regions || [],
      createdBy: req.user!.id,
    });
    
    res.status(201).json({
      message: 'Contractor created successfully',
      contractor,
    });
  } catch (error) {
    console.error('Create contractor error:', error);
    res.status(500).json({ message: 'Failed to create contractor' });
  }
});

// UPDATE contractor
router.put('/contractors/:contractorId', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { contractorId } = req.params;
    
    const contractor = await Contractor.findByIdAndUpdate(
      contractorId,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    
    if (!contractor) {
      return res.status(404).json({ message: 'Contractor not found' });
    }
    
    res.json({
      message: 'Contractor updated successfully',
      contractor,
    });
  } catch (error) {
    console.error('Update contractor error:', error);
    res.status(500).json({ message: 'Failed to update contractor' });
  }
});

// GET AI recommendations for contractor shortlist
router.post('/tenders/:tenderId/ai-recommendations', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    
    const tender = await Tender.findById(tenderId);
    if (!tender) {
      return res.status(404).json({ message: 'Tender not found' });
    }
    
    const contractors = await Contractor.find({
      status: 'Active',
      isApproved: true,
      categories: tender.category,
    });
    
    const scoredContractors = contractors.map(contractor => {
      const perf = contractor.performance;
      const score =
        (perf.averageRating || 0) * 0.3 +
        (perf.onTimeDelivery || 0) * 0.25 +
        (perf.budgetCompliance || 0) * 0.25 +
        (perf.qualityScore || 0) * 0.2;
      
      return {
        contractorId: contractor._id.toString(),
        name: contractor.name,
        score: Math.round(score * 100) / 100,
        reasoning: `Based on ${perf.projectsCompleted || 0} completed projects with ${perf.averageRating || 0}/5 rating. On-time delivery: ${perf.onTimeDelivery || 0}%, Budget compliance: ${perf.budgetCompliance || 0}%`,
      };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
    
    const estimatedCost = {
      low: tender.budgetedAmount * 0.85,
      mid: tender.budgetedAmount,
      high: tender.budgetedAmount * 1.15,
    };
    
    const recommendations = {
      suggestedContractors: scoredContractors,
      estimatedCost,
      riskAssessment: tender.budgetedAmount > 500000 
        ? 'High-value tender. Recommend detailed bid evaluation and reference checks.'
        : 'Standard tender. Proceed with normal evaluation process.',
      generatedAt: new Date(),
    };
    
    tender.aiRecommendations = recommendations;
    await tender.save();
    
    res.json(recommendations);
  } catch (error) {
    console.error('AI recommendations error:', error);
    res.status(500).json({ message: 'Failed to generate recommendations' });
  }
});

export default router;