import express from 'express';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth';
import { requireAdmin } from '../middleware/permissions';
import Tender from '../models/Tender';
import TenderBid from '../models/TenderBid';
import TenderRFI from '../models/TenderRFI';
import Contractor from '../models/Contractor';
import {
  sendEmail,
  buildTenderInviteEmail,
  buildBidConfirmationEmail,
  buildReminderEmail,
  buildAwardNotificationEmail,
  APP_URL,
} from '../services/emailService';

const router = express.Router();

// ==================== HELPER: generate unique bid token ====================
function generateBidToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

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
    const tender = await Tender.findById(tenderId).populate('createdBy', 'name email');
    if (!tender) return res.status(404).json({ message: 'Tender not found' });

    const bids = await TenderBid.find({ tenderId }).sort({ bidAmount: 1 });
    const rfis = await TenderRFI.find({ tenderId }).sort({ askedAt: -1 });

    res.json({ ...tender.toObject(), bids, rfis });
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
      title, description, category, budgetedAmount, submissionDeadline,
      scopeOfWorks, specifications, complianceRequirements, shortlistedContractors,
    } = req.body;

    if (!title || !budgetedAmount) {
      return res.status(400).json({ message: 'Title and budgeted amount are required' });
    }

    // Generate bid tokens for each shortlisted contractor upfront
    const contractorsWithTokens = (shortlistedContractors || []).map((c: any) => ({
      ...c,
      bidToken: generateBidToken(),
    }));

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
      shortlistedContractors: contractorsWithTokens,
      createdBy: req.user!.id,
    });

    const populatedTender = await Tender.findById(newTender._id).populate('createdBy', 'name email');

    res.status(201).json({ message: 'Tender created successfully', tender: populatedTender });
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
    if (!tender) return res.status(404).json({ message: 'Tender not found' });
    if (tender.status === 'Awarded') return res.status(400).json({ message: 'Cannot edit awarded tender' });

    // If updating shortlistedContractors, ensure new ones get bid tokens
    if (req.body.shortlistedContractors) {
      req.body.shortlistedContractors = req.body.shortlistedContractors.map((c: any) => ({
        ...c,
        bidToken: c.bidToken || generateBidToken(),
      }));
    }

    const updatedTender = await Tender.findByIdAndUpdate(
      tenderId, { $set: req.body }, { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    res.json({ message: 'Tender updated successfully', tender: updatedTender });
  } catch (error) {
    console.error('Update tender error:', error);
    res.status(500).json({ message: 'Failed to update tender' });
  }
});

// ISSUE tender — sends invitation emails to all shortlisted contractors
router.post('/tenders/:tenderId/issue', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const tender = await Tender.findById(tenderId);
    if (!tender) return res.status(404).json({ message: 'Tender not found' });
    if (tender.status !== 'Draft') return res.status(400).json({ message: 'Only draft tenders can be issued' });
    if (!tender.shortlistedContractors || tender.shortlistedContractors.length === 0) {
      return res.status(400).json({ message: 'Please shortlist contractors before issuing tender' });
    }

    tender.status = 'Issued';
    tender.issueDate = new Date();

    // Set invited dates and ensure tokens for all contractors
    tender.shortlistedContractors = tender.shortlistedContractors.map((c: any) => {
      const obj = c.toObject ? c.toObject() : { ...c };
      return {
        ...obj,
        invitedAt: new Date(),
        bidToken: obj.bidToken || generateBidToken(),
      };
    });

    await tender.save();

    // Send invitation emails to each contractor (fire-and-forget)
    const emailPromises = tender.shortlistedContractors.map(async (contractor: any) => {
      const bidSubmissionUrl = `${APP_URL}/contractor/bid/${contractor.bidToken}`;
      const emailData = buildTenderInviteEmail({
        contractorName: contractor.name,
        tenderNumber: tender.tenderNumber,
        tenderTitle: tender.title,
        description: tender.description,
        category: tender.category,
        submissionDeadline: tender.submissionDeadline?.toISOString(),
        scopeOfWorks: tender.scopeOfWorks,
        specifications: tender.specifications,
        complianceRequirements: tender.complianceRequirements,
        documents: tender.documents?.map((d: { fileName: string; fileUrl: string }) => ({ fileName: d.fileName, fileUrl: d.fileUrl })),
        bidSubmissionUrl,
      });

      return sendEmail({
        to: contractor.email,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
      });
    });

    // Don't block the response — send emails in background
    Promise.allSettled(emailPromises).then(results => {
      const sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
      console.log(`[Issue Tender] ${sent}/${results.length} invitation emails sent for ${tender.tenderNumber}`);
    });

    res.json({ message: 'Tender issued successfully. Invitation emails are being sent.', tender });
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
    if (!tender) return res.status(404).json({ message: 'Tender not found' });
    if (tender.status !== 'Draft') return res.status(400).json({ message: 'Only draft tenders can be deleted' });

    await TenderBid.deleteMany({ tenderId });
    await TenderRFI.deleteMany({ tenderId });
    await Tender.findByIdAndDelete(tenderId);

    res.json({ message: 'Tender deleted successfully' });
  } catch (error) {
    console.error('Delete tender error:', error);
    res.status(500).json({ message: 'Failed to delete tender' });
  }
});

// ==================== BID ROUTES (AUTHENTICATED) ====================

router.get('/tenders/:tenderId/bids', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const bids = await TenderBid.find({ tenderId }).populate('reviewedBy', 'name email').sort({ bidAmount: 1 });
    res.json(bids);
  } catch (error) {
    console.error('Get bids error:', error);
    res.status(500).json({ message: 'Failed to fetch bids' });
  }
});

router.post('/tenders/:tenderId/bids', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const { contractorId, contractorName, contractorEmail, bidAmount, breakdownItems, assumptions, exclusions, proposedStartDate, proposedCompletionDate, proposedDuration } = req.body;
    if (!bidAmount || !contractorId) return res.status(400).json({ message: 'Bid amount and contractor ID are required' });

    let bid = await TenderBid.findOne({ tenderId, contractorId });
    if (bid) {
      Object.assign(bid, { bidAmount, breakdownItems: breakdownItems || [], assumptions, exclusions, proposedStartDate, proposedCompletionDate, proposedDuration });
      await bid.save();
    } else {
      bid = await TenderBid.create({ tenderId, contractorId, contractorName, contractorEmail, bidAmount, breakdownItems: breakdownItems || [], assumptions, exclusions, proposedStartDate, proposedCompletionDate, proposedDuration });
    }
    res.json({ message: 'Bid saved successfully', bid });
  } catch (error) {
    console.error('Save bid error:', error);
    res.status(500).json({ message: 'Failed to save bid' });
  }
});

// SUBMIT bid (authenticated)
router.post('/tenders/:tenderId/bids/:bidId/submit', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { bidId } = req.params;
    const bid = await TenderBid.findById(bidId);
    if (!bid) return res.status(404).json({ message: 'Bid not found' });
    if (bid.status === 'Submitted') return res.status(400).json({ message: 'Bid already submitted' });

    bid.status = 'Submitted';
    bid.submittedAt = new Date();
    await bid.save();

    const tender = await Tender.findById(bid.tenderId);
    if (tender && tender.status === 'Issued') {
      tender.status = 'Bid Evaluation';
      await tender.save();
    }

    res.json({ message: 'Bid submitted successfully', bid });
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
    if (!bid) return res.status(404).json({ message: 'Bid not found' });

    bid.evaluationScore = evaluationScore;
    bid.evaluationNotes = evaluationNotes;
    bid.status = status || 'Under Review';
    bid.reviewedAt = new Date();
    bid.reviewedBy = req.user!.id;
    await bid.save();

    res.json({ message: 'Bid evaluated successfully', bid });
  } catch (error) {
    console.error('Evaluate bid error:', error);
    res.status(500).json({ message: 'Failed to evaluate bid' });
  }
});

// AWARD tender — sends award/rejection emails, populates budget
router.post('/tenders/:tenderId/award', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const { bidId, awardedReason } = req.body;
    if (!bidId) return res.status(400).json({ message: 'Bid ID is required' });

    const tender = await Tender.findById(tenderId);
    if (!tender) return res.status(404).json({ message: 'Tender not found' });

    const winningBid = await TenderBid.findById(bidId);
    if (!winningBid) return res.status(404).json({ message: 'Bid not found' });

    // Update tender
    tender.status = 'Awarded';
    tender.awardedContractorId = winningBid.contractorId;
    tender.awardedAmount = winningBid.bidAmount;
    tender.awardedReason = awardedReason;
    tender.awardDate = new Date();

    // Mark contractor as Submitted in shortlist
    tender.shortlistedContractors = tender.shortlistedContractors.map((c: any) => {
      const obj = c.toObject ? c.toObject() : { ...c };
      if (obj.contractorId === winningBid.contractorId) {
        return { ...obj, status: 'Submitted' };
      }
      return obj;
    });

    await tender.save();

    // Accept winning bid, reject others
    winningBid.status = 'Accepted';
    await winningBid.save();
    await TenderBid.updateMany({ tenderId, _id: { $ne: bidId } }, { status: 'Rejected' });

    // ------ Populate budget section ------
    try {
      // Try to import Budget model — if it exists in your project
      const Budget = (await import('../models/Budget')).default;
      await Budget.create({
        projectId: tender.projectId,
        category: tender.category,
        description: `${tender.title} — Awarded to ${winningBid.contractorName}`,
        tenderNumber: tender.tenderNumber,
        tenderId: tender._id,
        contractorName: winningBid.contractorName,
        contractorId: winningBid.contractorId,
        budgetedAmount: tender.budgetedAmount,
        awardedAmount: winningBid.bidAmount,
        variance: winningBid.bidAmount - tender.budgetedAmount,
        status: 'Committed',
        breakdownItems: winningBid.breakdownItems,
        createdBy: req.user!.id,
      });
      console.log(`[Award] Budget line item created for tender ${tender.tenderNumber}`);
    } catch (budgetErr: any) {
      // Budget model might not exist — that's ok, we'll create it
      console.warn('[Award] Budget model not found or error — skipping budget population:', budgetErr.message);
    }

    // ------ Send award/rejection emails ------
    const allBids = await TenderBid.find({ tenderId });
    const emailPromises = allBids.map(async (bid) => {
      const awarded = bid._id.toString() === bidId;
      const emailData = buildAwardNotificationEmail({
        contractorName: bid.contractorName,
        tenderNumber: tender.tenderNumber,
        tenderTitle: tender.title,
        awarded,
        awardedAmount: awarded ? bid.bidAmount : undefined,
        awardedReason: awarded ? awardedReason : undefined,
      });
      return sendEmail({ to: bid.contractorEmail, subject: emailData.subject, html: emailData.html, text: emailData.text });
    });
    Promise.allSettled(emailPromises);

    res.json({ message: 'Tender awarded successfully', tender });
  } catch (error) {
    console.error('Award tender error:', error);
    res.status(500).json({ message: 'Failed to award tender' });
  }
});

// ==================== RFI ROUTES ====================

router.get('/tenders/:tenderId/rfis', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const rfis = await TenderRFI.find({ tenderId }).populate('answeredBy', 'name email').sort({ askedAt: -1 });
    res.json(rfis);
  } catch (error) {
    console.error('Get RFIs error:', error);
    res.status(500).json({ message: 'Failed to fetch RFIs' });
  }
});

router.post('/tenders/:tenderId/rfis', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const { contractorId, contractorName, question } = req.body;
    if (!question) return res.status(400).json({ message: 'Question is required' });

    const rfi = await TenderRFI.create({ tenderId, contractorId, contractorName, question });

    const tender = await Tender.findById(tenderId);
    if (tender && tender.status === 'Issued') {
      tender.status = 'RFI';
      await tender.save();
    }
    res.status(201).json({ message: 'RFI created successfully', rfi });
  } catch (error) {
    console.error('Create RFI error:', error);
    res.status(500).json({ message: 'Failed to create RFI' });
  }
});

router.put('/rfis/:rfiId/answer', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { rfiId } = req.params;
    const { response } = req.body;
    if (!response) return res.status(400).json({ message: 'Response is required' });

    const rfi = await TenderRFI.findById(rfiId);
    if (!rfi) return res.status(404).json({ message: 'RFI not found' });

    rfi.response = response;
    rfi.status = 'Answered';
    rfi.answeredAt = new Date();
    rfi.answeredBy = req.user!.id;
    await rfi.save();

    res.json({ message: 'RFI answered successfully', rfi });
  } catch (error) {
    console.error('Answer RFI error:', error);
    res.status(500).json({ message: 'Failed to answer RFI' });
  }
});

// ==================== CONTRACTOR ROUTES ====================

router.get('/contractors', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const contractors = await Contractor.find({ status: { $ne: 'Blacklisted' } }).sort({ name: 1 });
    res.json(contractors);
  } catch (error) {
    console.error('Get contractors error:', error);
    res.status(500).json({ message: 'Failed to fetch contractors' });
  }
});

router.post('/contractors', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { name, email, phone, companyName, companyAddress, registrationNumber, categories, regions } = req.body;
    if (!name || !email || !companyName) return res.status(400).json({ message: 'Name, email, and company name are required' });

    const existing = await Contractor.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Contractor with this email already exists' });

    const contractor = await Contractor.create({ name, email, phone, companyName, companyAddress, registrationNumber, categories: categories || [], regions: regions || [], createdBy: req.user!.id });
    res.status(201).json({ message: 'Contractor created successfully', contractor });
  } catch (error) {
    console.error('Create contractor error:', error);
    res.status(500).json({ message: 'Failed to create contractor' });
  }
});

router.put('/contractors/:contractorId', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { contractorId } = req.params;
    const contractor = await Contractor.findByIdAndUpdate(contractorId, { $set: req.body }, { new: true, runValidators: true });
    if (!contractor) return res.status(404).json({ message: 'Contractor not found' });
    res.json({ message: 'Contractor updated successfully', contractor });
  } catch (error) {
    console.error('Update contractor error:', error);
    res.status(500).json({ message: 'Failed to update contractor' });
  }
});

// AI recommendations (unchanged)
router.post('/tenders/:tenderId/ai-recommendations', authMiddleware, requireAdmin, async (req: express.Request, res: express.Response) => {
  try {
    const { tenderId } = req.params;
    const tender = await Tender.findById(tenderId);
    if (!tender) return res.status(404).json({ message: 'Tender not found' });

    const contractors = await Contractor.find({ status: 'Active', isApproved: true, categories: tender.category });
    const scoredContractors = contractors.map(contractor => {
      const perf = contractor.performance;
      const score = (perf.averageRating || 0) * 0.3 + (perf.onTimeDelivery || 0) * 0.25 + (perf.budgetCompliance || 0) * 0.25 + (perf.qualityScore || 0) * 0.2;
      return {
        contractorId: contractor._id.toString(),
        name: contractor.name,
        score: Math.round(score * 100) / 100,
        reasoning: `Based on ${perf.projectsCompleted || 0} completed projects with ${perf.averageRating || 0}/5 rating. On-time: ${perf.onTimeDelivery || 0}%, Budget compliance: ${perf.budgetCompliance || 0}%`,
      };
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    const estimatedCost = { low: tender.budgetedAmount * 0.85, mid: tender.budgetedAmount, high: tender.budgetedAmount * 1.15 };
    const recommendations = {
      suggestedContractors: scoredContractors,
      estimatedCost,
      riskAssessment: tender.budgetedAmount > 500000 ? 'High-value tender. Recommend detailed bid evaluation and reference checks.' : 'Standard tender. Proceed with normal evaluation process.',
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

// ======================================================================
// PUBLIC CONTRACTOR ROUTES (NO AUTH) — accessed via unique bid token
// ======================================================================

// GET tender info for contractor via bid token
router.get('/public/bid/:token', async (req: express.Request, res: express.Response) => {
  try {
    const { token } = req.params;

    const tender = await Tender.findOne({
      'shortlistedContractors.bidToken': token,
    });

    if (!tender) {
      return res.status(404).json({ message: 'Invalid or expired bid link' });
    }

    const contractor = tender.shortlistedContractors.find(
      (c: any) => c.bidToken === token
    );

    if (!contractor) {
      return res.status(404).json({ message: 'Contractor not found' });
    }

    // Check if tender is still accepting bids
    if (!['Issued', 'RFI', 'Bid Evaluation'].includes(tender.status)) {
      return res.status(400).json({
        message: tender.status === 'Awarded'
          ? 'This tender has already been awarded'
          : 'This tender is no longer accepting bids',
      });
    }

    // Check deadline
    const isOverdue = tender.submissionDeadline && new Date(tender.submissionDeadline) < new Date();

    // Mark as Viewed
    if (contractor.status === 'Invited') {
      await Tender.updateOne(
        { _id: tender._id, 'shortlistedContractors.bidToken': token },
        { $set: { 'shortlistedContractors.$.status': 'Viewed' } }
      );
    }

    // Check if bid already exists
    const existingBid = await TenderBid.findOne({
      tenderId: tender._id,
      contractorId: contractor.contractorId,
    });

    res.json({
      tender: {
        _id: tender._id,
        tenderNumber: tender.tenderNumber,
        title: tender.title,
        description: tender.description,
        category: tender.category,
        status: tender.status,
        budgetedAmount: tender.budgetedAmount,
        submissionDeadline: tender.submissionDeadline,
        scopeOfWorks: tender.scopeOfWorks,
        specifications: tender.specifications,
        complianceRequirements: tender.complianceRequirements,
        documents: tender.documents,
      },
      contractor: {
        contractorId: contractor.contractorId,
        name: contractor.name,
        email: contractor.email,
        phone: contractor.phone,
      },
      existingBid: existingBid || null,
      isOverdue,
    });
  } catch (error) {
    console.error('Public bid GET error:', error);
    res.status(500).json({ message: 'Failed to load tender information' });
  }
});

// SUBMIT bid via public token — also populates budget and sends confirmation
router.post('/public/bid/:token', async (req: express.Request, res: express.Response) => {
  try {
    const { token } = req.params;
    const {
      bidAmount,
      breakdownItems,
      assumptions,
      exclusions,
      proposedStartDate,
      proposedCompletionDate,
      proposedDuration,
      comments,
    } = req.body;

    if (!bidAmount || bidAmount <= 0) {
      return res.status(400).json({ message: 'A valid bid amount is required' });
    }

    const tender = await Tender.findOne({ 'shortlistedContractors.bidToken': token });
    if (!tender) return res.status(404).json({ message: 'Invalid or expired bid link' });

    const contractor = tender.shortlistedContractors.find((c: any) => c.bidToken === token);
    if (!contractor) return res.status(404).json({ message: 'Contractor not found' });

    if (!['Issued', 'RFI', 'Bid Evaluation'].includes(tender.status)) {
      return res.status(400).json({ message: 'This tender is no longer accepting bids' });
    }

    // Check deadline
    if (tender.submissionDeadline && new Date(tender.submissionDeadline) < new Date()) {
      return res.status(400).json({ message: 'The submission deadline has passed' });
    }

    // Create or update bid
    let bid = await TenderBid.findOne({
      tenderId: tender._id,
      contractorId: contractor.contractorId,
    });

    const bidData = {
      bidAmount,
      breakdownItems: breakdownItems || [],
      assumptions: assumptions || comments || '',
      exclusions: exclusions || '',
      proposedStartDate,
      proposedCompletionDate,
      proposedDuration,
      status: 'Submitted' as const,
      submittedAt: new Date(),
    };

    if (bid) {
      if (bid.status === 'Submitted') {
        return res.status(400).json({ message: 'You have already submitted a bid for this tender' });
      }
      Object.assign(bid, bidData);
      await bid.save();
    } else {
      bid = await TenderBid.create({
        tenderId: tender._id,
        contractorId: contractor.contractorId,
        contractorName: contractor.name,
        contractorEmail: contractor.email,
        ...bidData,
      });
    }

    // Update contractor status in tender
    await Tender.updateOne(
      { _id: tender._id, 'shortlistedContractors.bidToken': token },
      { $set: { 'shortlistedContractors.$.status': 'Submitted' } }
    );

    // Move tender to Bid Evaluation if currently Issued
    if (tender.status === 'Issued') {
      tender.status = 'Bid Evaluation';
      await tender.save();
    }

    // ------ Populate budget section with submitted bid ------
    try {
      const Budget = (await import('../models/Budget')).default;
      
      // Check if a budget entry already exists for this tender + contractor
      const existingBudgetEntry = await Budget.findOne({
        tenderId: tender._id,
        contractorId: contractor.contractorId,
      });
      
      if (!existingBudgetEntry) {
        await Budget.create({
          projectId: tender.projectId,
          category: tender.category,
          description: `${tender.title} — Bid from ${contractor.name}`,
          tenderNumber: tender.tenderNumber,
          tenderId: tender._id,
          contractorName: contractor.name,
          contractorId: contractor.contractorId,
          budgetedAmount: tender.budgetedAmount,
          awardedAmount: bidAmount,
          variance: bidAmount - tender.budgetedAmount,
          status: 'Pending',
          breakdownItems: breakdownItems || [],
        });
        console.log(`[Public Bid] Budget entry created for ${contractor.name} on ${tender.tenderNumber}`);
      } else {
        existingBudgetEntry.awardedAmount = bidAmount;
        existingBudgetEntry.variance = bidAmount - tender.budgetedAmount;
        existingBudgetEntry.breakdownItems = breakdownItems || [];
        await existingBudgetEntry.save();
        console.log(`[Public Bid] Budget entry updated for ${contractor.name} on ${tender.tenderNumber}`);
      }
    } catch (budgetErr: any) {
      console.warn('[Public Bid] Budget model not available — skipping:', budgetErr.message);
    }

    // ------ Send confirmation email ------
    const emailData = buildBidConfirmationEmail({
      contractorName: contractor.name,
      tenderNumber: tender.tenderNumber,
      tenderTitle: tender.title,
      bidAmount,
      submittedAt: new Date().toISOString(),
    });

    sendEmail({
      to: contractor.email,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
    }).catch(err => console.error('Bid confirmation email error:', err));

    res.json({ message: 'Bid submitted successfully. A confirmation email has been sent.', bid });
  } catch (error) {
    console.error('Public bid POST error:', error);
    res.status(500).json({ message: 'Failed to submit bid' });
  }
});

// PUBLIC: Submit RFI via token
router.post('/public/bid/:token/rfi', async (req: express.Request, res: express.Response) => {
  try {
    const { token } = req.params;
    const { question } = req.body;
    if (!question) return res.status(400).json({ message: 'Question is required' });

    const tender = await Tender.findOne({ 'shortlistedContractors.bidToken': token });
    if (!tender) return res.status(404).json({ message: 'Invalid or expired bid link' });

    const contractor = tender.shortlistedContractors.find((c: any) => c.bidToken === token);
    if (!contractor) return res.status(404).json({ message: 'Contractor not found' });

    const rfi = await TenderRFI.create({
      tenderId: tender._id,
      contractorId: contractor.contractorId,
      contractorName: contractor.name,
      question,
    });

    if (tender.status === 'Issued') {
      tender.status = 'RFI';
      await tender.save();
    }

    res.status(201).json({ message: 'RFI submitted successfully', rfi });
  } catch (error) {
    console.error('Public RFI error:', error);
    res.status(500).json({ message: 'Failed to submit RFI' });
  }
});

// PUBLIC: Get RFIs for contractor via token
router.get('/public/bid/:token/rfis', async (req: express.Request, res: express.Response) => {
  try {
    const { token } = req.params;

    const tender = await Tender.findOne({ 'shortlistedContractors.bidToken': token });
    if (!tender) return res.status(404).json({ message: 'Invalid or expired bid link' });

    const contractor = tender.shortlistedContractors.find((c: any) => c.bidToken === token);
    if (!contractor) return res.status(404).json({ message: 'Contractor not found' });

    const rfis = await TenderRFI.find({
      tenderId: tender._id,
      contractorId: contractor.contractorId,
    }).sort({ askedAt: -1 });

    res.json(rfis);
  } catch (error) {
    console.error('Public RFIs GET error:', error);
    res.status(500).json({ message: 'Failed to fetch RFIs' });
  }
});

export default router;