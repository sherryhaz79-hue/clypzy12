const Campaign = require('../models/Campaign');
const Clip = require('../models/Clip');
const ClipEarningLedger = require('../models/ClipEarningLedger');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { ValidationError, NotFoundError } = require('../utils/errors');

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const calculateClipRawEarnings = (views, cpm) => roundMoney((Number(views || 0) / 1000) * Number(cpm || 0));

const getCampaignBudgetSnapshot = (campaign) => {
  const budgetTotal = roundMoney(campaign?.deposit || 0);
  const budgetReserved = roundMoney(campaign?.budgetReserved || 0);
  const budgetPaid = roundMoney(campaign?.budgetPaid || 0);
  const budgetAvailable = roundMoney(Math.max(0, budgetTotal - budgetReserved - budgetPaid));

  return {
    budgetTotal,
    budgetReserved,
    budgetPaid,
    budgetAvailable
  };
};

const isTransactionsUnavailableError = (error) => {
  const msg = String(error?.message || '');
  return (
    msg.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
    msg.includes('Standalone servers do not support transactions') ||
    msg.includes('replica set')
  );
};

const runInFinancialTransaction = async (work) => {
  const session = await Campaign.startSession();
  try {
    let output;
    await session.withTransaction(async () => {
      output = await work(session);
    });
    return output;
  } catch (error) {
    if (isTransactionsUnavailableError(error)) {
      console.warn(`[finance] Transactions unavailable, falling back to non-transactional execution: ${error.message}`);
      return work(null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const applySession = (query, session) => (session ? query.session(session) : query);

const saveWithSession = async (doc, session) => (
  doc.save(session ? { session } : undefined)
);

const createLedgerEvent = async (entry, session) => {
  if (session) {
    await ClipEarningLedger.create([entry], { session });
    return;
  }
  await ClipEarningLedger.create(entry);
};

const getRoundedClipLockedEarnings = (clip) => roundMoney(Math.max(0, Number(clip.lockedEarnings ?? clip.earnings ?? 0)));
const getRoundedClipPaidOut = (clip, lockedEarnings = null) => {
  const locked = lockedEarnings === null ? getRoundedClipLockedEarnings(clip) : lockedEarnings;
  return roundMoney(Math.min(locked, Math.max(0, Number(clip.paidOutAmount || 0))));
};

const recomputeCampaignEarnings = async (campaignId) => {
  const campaign = await Campaign.findOne({ campaignId });
  if (!campaign) return null;

  const clips = await Clip.find({ campaignId }).sort({ submittedAt: 1, createdAt: 1, clipId: 1 });
  let totalReserved = 0;
  let totalPaid = 0;
  const changedClips = [];

  for (const clip of clips) {
    let clipChanged = false;

    if (clip.status === 'approved') {
      let lockedEarnings = getRoundedClipLockedEarnings(clip);
      let paidOutAmount = getRoundedClipPaidOut(clip, lockedEarnings);

      if (!clip.earningsLocked) {
        clip.earningsLocked = true;
        clipChanged = true;
      }

      if (roundMoney(clip.lockedEarnings || 0) !== lockedEarnings) {
        clip.lockedEarnings = lockedEarnings;
        clipChanged = true;
      }

      if (roundMoney(clip.paidOutAmount || 0) !== paidOutAmount) {
        clip.paidOutAmount = paidOutAmount;
        clipChanged = true;
      }

      if (roundMoney(clip.earnings || 0) !== lockedEarnings) {
        clip.earnings = lockedEarnings;
        clipChanged = true;
      }

      const reservedAmount = roundMoney(Math.max(0, lockedEarnings - paidOutAmount));
      totalReserved = roundMoney(totalReserved + reservedAmount);
      totalPaid = roundMoney(totalPaid + paidOutAmount);
    } else if (roundMoney(clip.earnings || 0) !== 0) {
      clip.earnings = 0;
      clipChanged = true;
    }

    if (clipChanged) {
      changedClips.push(saveWithSession(clip, null));
    }
  }

  if (changedClips.length > 0) {
    await Promise.all(changedClips);
  }

  campaign.budgetReserved = totalReserved;
  campaign.budgetPaid = totalPaid;
  await campaign.save();

  const budget = getCampaignBudgetSnapshot(campaign);
  return {
    campaignId,
    budgetTotal: budget.budgetTotal,
    budgetReserved: budget.budgetReserved,
    budgetPaid: budget.budgetPaid,
    budgetRemaining: budget.budgetAvailable
  };
};

const approveClipWithReservation = async (clipId, opts = {}) => runInFinancialTransaction(async (session) => {
  const clip = await applySession(Clip.findOne({ clipId }), session);
  if (!clip) throw new NotFoundError('Clip');

  const campaign = await applySession(Campaign.findOne({ campaignId: clip.campaignId }), session);
  if (!campaign) throw new NotFoundError('Campaign');

  const currentViews = Number.isFinite(Number(opts.currentViews)) ? Number(opts.currentViews) : Number(clip.views || 0);
  const viewsAtSubmit = Number.isFinite(Number(clip.viewsAtSubmit)) ? Number(clip.viewsAtSubmit) : null;
  if (viewsAtSubmit === null) {
    throw new ValidationError('Clip submission baseline is missing. Re-submit the clip to continue.');
  }

  const eligibleViews = Math.max(0, currentViews - viewsAtSubmit);
  const minViewsForPayout = Math.max(0, Number(campaign.minViewsForPayout || 0));

  if (eligibleViews < minViewsForPayout) {
    throw new ValidationError(`Clip has ${eligibleViews.toLocaleString()} eligible views and needs at least ${minViewsForPayout.toLocaleString()} for payout.`);
  }

  const budgetBefore = getCampaignBudgetSnapshot(campaign);
  if (budgetBefore.budgetAvailable <= 0) {
    throw new ValidationError('Campaign budget is exhausted.');
  }

  const rawEarnings = calculateClipRawEarnings(eligibleViews, campaign.CPM);
  const lockedEarnings = roundMoney(Math.min(rawEarnings, budgetBefore.budgetAvailable));
  if (lockedEarnings <= 0) {
    throw new ValidationError('Clip did not generate payable earnings.');
  }

  const approvedAt = new Date();

  clip.status = 'approved';
  clip.views = currentViews;
  clip.viewsAtApproval = currentViews;
  clip.eligibleViewsAtApproval = eligibleViews;
  clip.lockedEarnings = lockedEarnings;
  clip.earnings = lockedEarnings;
  clip.earningsLocked = true;
  clip.paidOutAmount = 0;
  clip.approvedAt = approvedAt;
  clip.reservedAt = approvedAt;

  campaign.budgetReserved = roundMoney(Number(campaign.budgetReserved || 0) + lockedEarnings);

  await Promise.all([
    saveWithSession(clip, session),
    saveWithSession(campaign, session),
    createLedgerEvent({
      eventType: 'reserve',
      campaignId: clip.campaignId,
      clipId: clip.clipId,
      creatorId: clip.creatorId,
      amount: lockedEarnings,
      metadata: {
        viewsAtSubmit,
        viewsAtApproval: currentViews,
        eligibleViews,
        campaignCPM: Number(campaign.CPM || 0),
        minViewsForPayout,
        rawEarnings,
        budgetBefore,
        budgetAfter: getCampaignBudgetSnapshot(campaign)
      }
    }, session)
  ]);

  return {
    clip,
    campaign,
    rawEarnings,
    lockedEarnings,
    eligibleViews,
    budget: getCampaignBudgetSnapshot(campaign)
  };
});

const releaseClipReservation = async (clipId, reason = 'clip_flagged') => runInFinancialTransaction(async (session) => {
  const clip = await applySession(Clip.findOne({ clipId }), session);
  if (!clip) throw new NotFoundError('Clip');

  if (clip.status !== 'approved') {
    clip.status = 'flagged';
    await saveWithSession(clip, session);
    return { clip, releasedAmount: 0 };
  }

  const campaign = await applySession(Campaign.findOne({ campaignId: clip.campaignId }), session);
  if (!campaign) throw new NotFoundError('Campaign');

  const lockedEarnings = getRoundedClipLockedEarnings(clip);
  const paidOutAmount = getRoundedClipPaidOut(clip, lockedEarnings);
  const releasableAmount = roundMoney(Math.max(0, lockedEarnings - paidOutAmount));

  if (paidOutAmount > 0) {
    throw new ValidationError('Cannot flag an approved clip that has already been settled in payouts.');
  }

  if (releasableAmount > 0) {
    campaign.budgetReserved = roundMoney(Math.max(0, Number(campaign.budgetReserved || 0) - releasableAmount));
  }

  clip.status = 'flagged';
  clip.earnings = 0;
  clip.lockedEarnings = 0;
  clip.earningsLocked = false;
  clip.paidOutAmount = 0;
  clip.viewsAtApproval = null;
  clip.eligibleViewsAtApproval = null;
  clip.approvedAt = null;
  clip.reservedAt = null;

  await Promise.all([
    saveWithSession(clip, session),
    saveWithSession(campaign, session),
    releasableAmount > 0
      ? createLedgerEvent({
          eventType: 'release',
          campaignId: clip.campaignId,
          clipId: clip.clipId,
          creatorId: clip.creatorId,
          amount: -releasableAmount,
          metadata: { reason }
        }, session)
      : Promise.resolve()
  ]);

  return {
    clip,
    campaign,
    releasedAmount: releasableAmount
  };
});

const settleCompletedPayout = async (payment) => {
  if (!payment || payment.type !== 'payout' || payment.status !== 'completed' || !payment.creatorId) return null;
  if (Array.isArray(payment.metadata?.payoutAllocations) && payment.metadata.payoutAllocations.length > 0) {
    return payment.metadata.payoutAllocations;
  }

  return runInFinancialTransaction(async (session) => {
    const freshPayment = await applySession(Payment.findOne({ paymentId: payment.paymentId }), session);
    if (!freshPayment || freshPayment.type !== 'payout' || freshPayment.status !== 'completed') return null;

    if (Array.isArray(freshPayment.metadata?.payoutAllocations) && freshPayment.metadata.payoutAllocations.length > 0) {
      return freshPayment.metadata.payoutAllocations;
    }

    const clips = await applySession(
      Clip.find({ creatorId: freshPayment.creatorId, status: 'approved' }).sort({ approvedAt: 1, submittedAt: 1, createdAt: 1, clipId: 1 }),
      session
    );
    const campaignIds = [...new Set(clips.map((clip) => clip.campaignId))];
    const campaigns = await applySession(Campaign.find({ campaignId: { $in: campaignIds } }), session);
    const campaignMap = new Map(campaigns.map((campaign) => [campaign.campaignId, campaign]));

    let remainingAmount = roundMoney(freshPayment.amount || 0);
    const allocations = [];
    const changedClips = [];
    const changedCampaigns = new Map();

    for (const clip of clips) {
      if (remainingAmount <= 0) break;
      const lockedEarnings = getRoundedClipLockedEarnings(clip);
      const paidOutAmount = getRoundedClipPaidOut(clip, lockedEarnings);
      const releasable = roundMoney(Math.max(0, lockedEarnings - paidOutAmount));
      if (releasable <= 0) continue;

      const allocationAmount = roundMoney(Math.min(releasable, remainingAmount));
      if (allocationAmount <= 0) continue;

      const campaign = campaignMap.get(clip.campaignId);
      if (!campaign) continue;

      clip.paidOutAmount = roundMoney(paidOutAmount + allocationAmount);
      changedClips.push(clip);

      campaign.budgetReserved = roundMoney(Math.max(0, Number(campaign.budgetReserved || 0) - allocationAmount));
      campaign.budgetPaid = roundMoney(Number(campaign.budgetPaid || 0) + allocationAmount);
      changedCampaigns.set(campaign.campaignId, campaign);

      allocations.push({
        campaignId: clip.campaignId,
        clipId: clip.clipId,
        amount: allocationAmount
      });

      remainingAmount = roundMoney(remainingAmount - allocationAmount);
    }

    if (remainingAmount > 0) {
      throw new ValidationError('Unable to settle payout against reserved clip earnings.');
    }

    await Promise.all([
      ...changedClips.map((clip) => saveWithSession(clip, session)),
      ...Array.from(changedCampaigns.values()).map((campaign) => saveWithSession(campaign, session)),
      ...allocations.map((allocation) => {
        const clip = clips.find((item) => item.clipId === allocation.clipId);
        if (!clip) return Promise.resolve();

        return createLedgerEvent({
          eventType: 'payout_settle',
          paymentId: freshPayment.paymentId,
          campaignId: allocation.campaignId,
          clipId: allocation.clipId,
          creatorId: freshPayment.creatorId,
          amount: -allocation.amount,
          metadata: {
            payoutAmount: allocation.amount
          }
        }, session);
      })
    ]);

    freshPayment.metadata = {
      ...(freshPayment.metadata || {}),
      payoutAllocations: allocations,
      payoutSettledAt: new Date().toISOString()
    };
    await saveWithSession(freshPayment, session);

    return allocations;
  });
};

const reverseCompletedPayoutSettlement = async (payment) => {
  if (!payment || payment.type !== 'payout' || !payment.paymentId) return null;

  return runInFinancialTransaction(async (session) => {
    const freshPayment = await applySession(Payment.findOne({ paymentId: payment.paymentId }), session);
    if (!freshPayment || freshPayment.type !== 'payout') return null;

    const allocations = Array.isArray(freshPayment.metadata?.payoutAllocations)
      ? freshPayment.metadata.payoutAllocations
      : [];
    if (allocations.length === 0) return [];

    const clipIds = allocations.map((allocation) => allocation.clipId);
    const campaignIds = allocations.map((allocation) => allocation.campaignId);
    const [clips, campaigns] = await Promise.all([
      applySession(Clip.find({ clipId: { $in: clipIds } }), session),
      applySession(Campaign.find({ campaignId: { $in: campaignIds } }), session)
    ]);

    const clipMap = new Map(clips.map((clip) => [clip.clipId, clip]));
    const campaignMap = new Map(campaigns.map((campaign) => [campaign.campaignId, campaign]));

    for (const allocation of allocations) {
      const amount = roundMoney(allocation.amount || 0);
      if (amount <= 0) continue;

      const clip = clipMap.get(allocation.clipId);
      const campaign = campaignMap.get(allocation.campaignId);
      if (!clip || !campaign) continue;

      clip.paidOutAmount = roundMoney(Math.max(0, Number(clip.paidOutAmount || 0) - amount));
      campaign.budgetReserved = roundMoney(Number(campaign.budgetReserved || 0) + amount);
      campaign.budgetPaid = roundMoney(Math.max(0, Number(campaign.budgetPaid || 0) - amount));
    }

    await Promise.all([
      ...Array.from(clipMap.values()).map((clip) => saveWithSession(clip, session)),
      ...Array.from(campaignMap.values()).map((campaign) => saveWithSession(campaign, session)),
      ...allocations.map((allocation) => createLedgerEvent({
        eventType: 'payout_revert',
        paymentId: freshPayment.paymentId,
        campaignId: allocation.campaignId,
        clipId: allocation.clipId,
        creatorId: freshPayment.creatorId,
        amount: allocation.amount,
        metadata: {
          payoutAmount: allocation.amount
        }
      }, session))
    ]);

    const nextMetadata = { ...(freshPayment.metadata || {}) };
    delete nextMetadata.payoutAllocations;
    delete nextMetadata.payoutSettledAt;
    freshPayment.metadata = nextMetadata;
    await saveWithSession(freshPayment, session);

    return allocations;
  });
};

const recomputeAllCampaignEarnings = async () => {
  const campaigns = await Campaign.find({}).select('campaignId');
  const results = await Promise.all(campaigns.map((c) => recomputeCampaignEarnings(c.campaignId)));
  return results.filter(Boolean);
};

const recomputeCreatorWallet = async (creatorId) => {
  const creator = await User.findOne({ userId: creatorId, role: 'creator' });
  if (!creator) return null;

  const [approvedEarningsAgg, payoutAgg] = await Promise.all([
    Clip.aggregate([
      { $match: { creatorId, status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$earnings' } } }
    ]),
    Payment.aggregate([
      { $match: { creatorId, type: 'payout' } },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' }
        }
      }
    ])
  ]);

  const approvedEarnings = roundMoney(approvedEarningsAgg[0]?.total || 0);
  const completedPayouts = roundMoney(
    payoutAgg.filter((p) => p._id === 'completed').reduce((sum, p) => sum + Number(p.total || 0), 0)
  );
  const pendingPayouts = roundMoney(
    payoutAgg
      .filter((p) => ['pending', 'processing'].includes(p._id))
      .reduce((sum, p) => sum + Number(p.total || 0), 0)
  );

  const withdrawableBalance = roundMoney(Math.max(0, approvedEarnings - completedPayouts - pendingPayouts));

  creator.wallet.availableBalance = approvedEarnings;
  creator.wallet.pendingBalance = pendingPayouts;
  creator.wallet.withdrawableBalance = withdrawableBalance;
  await creator.save();

  return {
    creatorId,
    availableBalance: approvedEarnings,
    pendingBalance: pendingPayouts,
    withdrawableBalance
  };
};

const recomputeAllCreatorWallets = async () => {
  const creators = await User.find({ role: 'creator', isActive: true }).select('userId');
  const wallets = await Promise.all(creators.map((u) => recomputeCreatorWallet(u.userId)));
  return wallets.filter(Boolean);
};

const recomputePlatformFinancials = async () => {
  await recomputeAllCampaignEarnings();
  await recomputeAllCreatorWallets();
};

module.exports = {
  roundMoney,
  calculateClipRawEarnings,
  getCampaignBudgetSnapshot,
  approveClipWithReservation,
  releaseClipReservation,
  settleCompletedPayout,
  reverseCompletedPayoutSettlement,
  recomputeCampaignEarnings,
  recomputeAllCampaignEarnings,
  recomputeCreatorWallet,
  recomputeAllCreatorWallets,
  recomputePlatformFinancials
};
