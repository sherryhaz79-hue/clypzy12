const Payment = require('../models/Payment');
const Campaign = require('../models/Campaign');
const Clip = require('../models/Clip');
const User = require('../models/User');
const generateId = require('../utils/generateId');
const config = require('../config');
const {
  recomputeCampaignEarnings,
  recomputeCreatorWallet,
  settleCompletedPayout,
  reverseCompletedPayoutSettlement
} = require('../services/finance');
const { NotFoundError, ForbiddenError, ValidationError } = require('../utils/errors');

// POST /api/payments/deposit
const createDeposit = async (req, res, next) => {
  try {
    const { campaignId, amount } = req.body;
    const paymentMethod = req.body.paymentMethod || req.body.method || 'stripe';
    const parsedAmount = Number(amount);

    const campaign = await Campaign.findOne({ campaignId });
    if (!campaign) throw new NotFoundError('Campaign');
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new ValidationError('Amount must be a positive number');
    }

    if (req.user.role === 'brand' && campaign.brandId !== req.user.userId) {
      throw new ForbiddenError('Cannot deposit to another brand\'s campaign');
    }

    const initialStatus = config.payments.autoComplete ? 'completed' : 'pending';
    const payment = await Payment.create({
      paymentId: generateId('pay'),
      type: 'deposit',
      campaignId,
      amount: parsedAmount,
      paymentMethod,
      status: initialStatus,
      metadata: {
        simulated: true,
        autoCompleted: config.payments.autoComplete
      }
    });

    if (initialStatus === 'completed') {
      campaign.deposit = Number(campaign.deposit || 0) + parsedAmount;
      await campaign.save();
      await recomputeCampaignEarnings(campaignId);
      const creatorIds = await Clip.distinct('creatorId', { campaignId });
      await Promise.all(creatorIds.map((id) => recomputeCreatorWallet(id)));
    }

    res.status(201).json({ payment });
  } catch (error) {
    next(error);
  }
};

// POST /api/payments/payout
const createPayout = async (req, res, next) => {
  try {
    const { creatorId, amount } = req.body;
    const paymentMethod = req.body.paymentMethod || req.body.method || 'stripe';
    const targetCreatorId = req.user.role === 'creator' ? req.user.userId : creatorId;
    const parsedAmount = Number(amount);

    if (!targetCreatorId) throw new ValidationError('creatorId is required');
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new ValidationError('Amount must be a positive number');
    }

    const creator = await User.findOne({ userId: targetCreatorId, role: 'creator' });
    if (!creator) throw new NotFoundError('Creator');
    if (req.user.role === 'creator' && targetCreatorId !== req.user.userId) {
      throw new ForbiddenError('Cannot request payout for another creator');
    }

    await recomputeCreatorWallet(targetCreatorId);
    const freshCreator = await User.findOne({ userId: targetCreatorId, role: 'creator' });
    if (!freshCreator) throw new NotFoundError('Creator');

    if (freshCreator.wallet.withdrawableBalance < parsedAmount) {
      throw new ValidationError('Insufficient withdrawable balance');
    }

    const initialStatus = config.payments.autoComplete ? 'completed' : 'pending';
    const payment = await Payment.create({
      paymentId: generateId('pay'),
      type: 'payout',
      creatorId: targetCreatorId,
      amount: parsedAmount,
      paymentMethod,
      status: initialStatus,
      metadata: {
        simulated: true,
        autoCompleted: config.payments.autoComplete
      }
    });

    if (initialStatus === 'completed') {
      try {
        await settleCompletedPayout(payment);
      } catch (error) {
        payment.status = 'failed';
        payment.metadata = {
          ...(payment.metadata || {}),
          settlementError: error.message
        };
        await payment.save();
        throw error;
      }
    }

    await recomputeCreatorWallet(targetCreatorId);

    res.status(201).json({ payment });
  } catch (error) {
    next(error);
  }
};

// GET /api/payments
const listPayments = async (req, res, next) => {
  try {
    const { type, status, campaignId, creatorId, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (status) filter.status = status;
    if (campaignId) filter.campaignId = campaignId;
    if (creatorId) filter.creatorId = creatorId;

    // Non-admins can only see their own payments
    if (req.user.role === 'brand') {
      const campaigns = await Campaign.find({ brandId: req.user.userId }).select('campaignId');
      const campaignIds = campaigns.map(c => c.campaignId);
      filter.campaignId = { $in: campaignIds };
    } else if (req.user.role === 'creator') {
      filter.creatorId = req.user.userId;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [payments, total] = await Promise.all([
      Payment.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      Payment.countDocuments(filter)
    ]);

    res.json({
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/payments/:paymentId
const getPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ paymentId: req.params.paymentId });
    if (!payment) throw new NotFoundError('Payment');

    if (req.user.role === 'creator' && payment.creatorId !== req.user.userId) {
      throw new ForbiddenError('Cannot view another creator\'s payment');
    }
    if (req.user.role === 'brand') {
      const campaign = payment.campaignId
        ? await Campaign.findOne({ campaignId: payment.campaignId }).select('brandId')
        : null;
      if (!campaign || campaign.brandId !== req.user.userId) {
        throw new ForbiddenError('Cannot view another brand\'s payment');
      }
    }

    res.json({ payment });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/payments/:paymentId/status (admin - process payment)
const updatePaymentStatus = async (req, res, next) => {
  try {
    const { status, externalTransactionId } = req.body;
    const payment = await Payment.findOne({ paymentId: req.params.paymentId });
    if (!payment) throw new NotFoundError('Payment');
    const previousStatus = payment.status;

    const validTransitions = {
      pending: ['processing', 'completed', 'failed'],
      processing: ['completed', 'failed'],
      completed: ['failed', 'pending'],
      failed: ['pending']
    };

    if (!validTransitions[payment.status].includes(status)) {
      throw new ValidationError(`Cannot transition from ${payment.status} to ${status}`);
    }

    const transitionedToCompleted = previousStatus !== 'completed' && status === 'completed';
    const transitionedFromCompleted = previousStatus === 'completed' && status !== 'completed';

    if (payment.type === 'deposit' && payment.campaignId && transitionedFromCompleted) {
      const campaign = await Campaign.findOne({ campaignId: payment.campaignId });
      if (campaign) {
        const nextDeposit = Math.max(0, Number(campaign.deposit || 0) - Number(payment.amount || 0));
        const accountingFloor = Number(campaign.budgetReserved || 0) + Number(campaign.budgetPaid || 0);
        if (nextDeposit < accountingFloor) {
          throw new ValidationError(
            `Cannot set campaign deposit below reserved+paid amount ($${accountingFloor.toFixed(2)})`
          );
        }
      }
    }

    payment.status = status;
    if (externalTransactionId) {
      payment.externalTransactionId = externalTransactionId;
    }

    await payment.save();

    // Apply side effects when transitioning in/out of completed.
    if (payment.type === 'deposit' && payment.campaignId) {
      if (transitionedToCompleted || transitionedFromCompleted) {
        const delta = transitionedToCompleted ? payment.amount : -payment.amount;
        const campaign = await Campaign.findOne({ campaignId: payment.campaignId });
        if (campaign) {
          const nextDeposit = Math.max(0, Number(campaign.deposit || 0) + delta);
          const accountingFloor = Number(campaign.budgetReserved || 0) + Number(campaign.budgetPaid || 0);
          if (nextDeposit < accountingFloor) {
            throw new ValidationError(
              `Cannot set campaign deposit below reserved+paid amount ($${accountingFloor.toFixed(2)})`
            );
          }
          campaign.deposit = nextDeposit;
          await campaign.save();
          await recomputeCampaignEarnings(payment.campaignId);
        }
      }
    }

    if (payment.type === 'payout' && payment.creatorId) {
      if (transitionedToCompleted) {
        try {
          await settleCompletedPayout(payment);
        } catch (error) {
          payment.status = previousStatus;
          await payment.save();
          throw error;
        }
      } else if (transitionedFromCompleted) {
        try {
          await reverseCompletedPayoutSettlement(payment);
        } catch (error) {
          payment.status = previousStatus;
          await payment.save();
          throw error;
        }
      }

      await recomputeCreatorWallet(payment.creatorId);
    }

    res.json({ payment });
  } catch (error) {
    next(error);
  }
};

// GET /api/payments/audit
const getPaymentAudit = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const [deposits, payouts, summary] = await Promise.all([
      Payment.aggregate([
        { $match: { ...filter, type: 'deposit' } },
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } }
      ]),
      Payment.aggregate([
        { $match: { ...filter, type: 'payout' } },
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } }
      ]),
      Payment.aggregate([
        { $match: filter },
        { $group: { _id: null, totalTransactions: { $sum: 1 }, totalVolume: { $sum: '$amount' } } }
      ])
    ]);

    res.json({
      deposits,
      payouts,
      summary: summary[0] || { totalTransactions: 0, totalVolume: 0 }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDeposit,
  createPayout,
  listPayments,
  getPayment,
  updatePaymentStatus,
  getPaymentAudit
};
