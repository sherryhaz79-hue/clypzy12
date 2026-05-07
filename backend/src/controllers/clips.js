//backend/src/controllers/clips.js

const Youtube = require('youtube-api');
const Clip = require('../models/Clip');
const Campaign = require('../models/Campaign');
const generateId = require('../utils/generateId');
const config = require('../config');
const { fetchInstagramMetricsByShortcode } = require('../services/instagramReelFetcher');
const {
  approveClipWithReservation,
  releaseClipReservation,
  recomputeCampaignEarnings,
  recomputeCreatorWallet
} = require('../services/finance');
const { acquireMetricsFetchSlot } = require('../services/metricsRateLimiter');
const { NotFoundError, ForbiddenError, ValidationError } = require('../utils/errors');

const YOUTUBE_DATA_API_KEY = config.youtubeSr.apiKey;
if (YOUTUBE_DATA_API_KEY) {
  Youtube.authenticate({
    type: 'key',
    key: YOUTUBE_DATA_API_KEY
  });
} else {
  console.warn('YouTube Data API key is missing; YouTube metrics refresh is disabled.');
}

const INSTAGRAM_CACHE_TTL_MS = config.instagramGraph.cacheTtlMs;
const YOUTUBE_CACHE_TTL_MS = config.youtubeSr.cacheTtlMs;
const METRICS_ON_DEMAND_CLIP_LIMIT = Math.max(1, Number(config.externalMetrics.onDemandClipRefreshLimit || 5));
const METRICS_SCHEDULER_BATCH_SIZE = Math.max(1, Number(config.externalMetrics.schedulerBatchSize || 50));
const METRICS_MAX_CONCURRENCY = Math.max(1, Number(config.externalMetrics.maxConcurrentRefreshes || 1));
const METRICS_FAILURE_COOLDOWN_MS = Math.max(1000, Number(config.externalMetrics.failureCooldownMs || 30000));

const metricsFailureCooldowns = new Map();

const isInFailureCooldown = (key) => {
  const lastFailure = metricsFailureCooldowns.get(key);
  if (!lastFailure) return false;
  if (Date.now() - lastFailure >= METRICS_FAILURE_COOLDOWN_MS) {
    metricsFailureCooldowns.delete(key);
    return false;
  }
  return true;
};

const markFailureCooldown = (key) => {
  metricsFailureCooldowns.set(key, Date.now());
};

const extractInstagramShortcode = (link = '') => {
  try {
    const url = new URL(link);
    const isInstagramHost = /(^|\.)instagram\.com$/i.test(url.hostname);
    if (!isInstagramHost) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    if (['reel', 'p', 'tv', 'reels'].includes(parts[0].toLowerCase())) {
      return parts[1] || null;
    }

    return null;
  } catch {
    return null;
  }
};

const extractYouTubeVideoId = (link = '') => {
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be') {
      return parts[0] || null;
    }

    const isYouTubeHost = /(^|\.)youtube\.com$/i.test(host) || /(^|\.)youtube-nocookie\.com$/i.test(host);
    if (!isYouTubeHost) return null;

    const segmentIndex = parts.findIndex((segment) => ['shorts', 'embed', 'live', 'v'].includes(segment.toLowerCase()));
    if (segmentIndex >= 0 && parts[segmentIndex + 1]) {
      return parts[segmentIndex + 1];
    }

    if (parts[0] && parts[0].toLowerCase() === 'watch') {
      return url.searchParams.get('v') || null;
    }

    return url.searchParams.get('v') || null;
  } catch {
    return null;
  }
};

const isCacheExpired = (fetchedAt, ttlMs) => {
  if (!fetchedAt) return true;
  return Date.now() - new Date(fetchedAt).getTime() >= ttlMs;
};

const shouldForceRefresh = (options = {}) => Boolean(options.forceFetch);

const shouldAttemptRefresh = (fetchedAt, ttlMs, options = {}) => (
  shouldForceRefresh(options) || isCacheExpired(fetchedAt, ttlMs)
);

const tryAcquireMetricsFetch = (options = {}) => {
  const context = options.rateLimitContext || 'scheduler';
  const decision = acquireMetricsFetchSlot({ context });
  if (decision.allowed) return true;

  if (options.failOnRateLimit) {
    throw new ValidationError('View metrics refresh is temporarily rate-limited. Please retry shortly.');
  }
  return false;
};

const runLimitedMetricRefresh = async (fetchFn, options = {}) => {
  const allowed = tryAcquireMetricsFetch(options);
  if (!allowed) return null;
  return fetchFn();
};

const clipNeedsExternalRefresh = (clip) => {
  const hasInstagram = Boolean(clip.instagramShortcode || extractInstagramShortcode(clip.clipLink));
  const hasYouTube = Boolean(clip.youtubeVideoId || extractYouTubeVideoId(clip.clipLink));

  return (
    (hasInstagram && isCacheExpired(clip.instagramMetricsFetchedAt, INSTAGRAM_CACHE_TTL_MS)) ||
    (hasYouTube && isCacheExpired(clip.youtubeMetricsFetchedAt, YOUTUBE_CACHE_TTL_MS))
  );
};

const getOnDemandRefreshCandidates = (clips) => clips
  .filter((clip) => clipNeedsExternalRefresh(clip))
  .slice(0, METRICS_ON_DEMAND_CLIP_LIMIT);

const clipUsesExternalMetrics = (clip) => (
  Boolean(clip.instagramShortcode) ||
  Boolean(clip.youtubeVideoId) ||
  Boolean(extractYouTubeVideoId(clip.clipLink))
);

const toFiniteNumberOrNull = (value) => (
  Number.isFinite(Number(value)) ? Number(value) : null
);

const resolveExternalViewsForClip = (clip) => {
  const youtubeViews = toFiniteNumberOrNull(clip.youtubeViewCount);
  const instagramViews = toFiniteNumberOrNull(clip.instagramVideoPlayCount);
  const preferred = [];

  if (clip.youtubeVideoId && youtubeViews !== null) {
    preferred.push(youtubeViews);
  }
  if (clip.instagramShortcode && instagramViews !== null) {
    preferred.push(instagramViews);
  }

  if (preferred.length > 0) {
    return Math.max(...preferred);
  }

  if (youtubeViews !== null && instagramViews !== null) {
    return Math.max(youtubeViews, instagramViews);
  }
  if (youtubeViews !== null) return youtubeViews;
  if (instagramViews !== null) return instagramViews;

  return null;
};

const syncClipViewsFromExternalMetrics = (clip) => {
  const resolvedViews = resolveExternalViewsForClip(clip);
  if (resolvedViews === null) return false;
  if (Number(clip.views) === Number(resolvedViews)) return false;

  clip.views = resolvedViews;
  clip.$locals = clip.$locals || {};
  clip.$locals.externalViewsChanged = true;
  return true;
};

const refreshInstagramMetricsForClip = async (clip, options = {}) => {
  if (!config.instagramGraph.enabled) return clip;

  const shortcode = clip.instagramShortcode || extractInstagramShortcode(clip.clipLink);
  if (!shortcode) return clip;

  clip.instagramShortcode = shortcode;
  const cooldownKey = `instagram:${clip.clipId || shortcode}`;

  if (!shouldForceRefresh(options) && isInFailureCooldown(cooldownKey)) {
    return clip;
  }

  if (!shouldAttemptRefresh(clip.instagramMetricsFetchedAt, INSTAGRAM_CACHE_TTL_MS, options)) {
    const didSyncViews = syncClipViewsFromExternalMetrics(clip);
    if (didSyncViews) {
      await clip.save();
    }
    return clip;
  }

  try {
    const metrics = await runLimitedMetricRefresh(
      () => fetchInstagramMetricsByShortcode(shortcode),
      options
    );
    if (!metrics) {
      markFailureCooldown(cooldownKey);
      return clip;
    }
    clip.instagramThumbnailUrl = metrics.thumbnailUrl;
    clip.instagramVideoPlayCount = metrics.videoPlayCount;
    clip.instagramMetricsFetchedAt = new Date();
    syncClipViewsFromExternalMetrics(clip);
    await clip.save();
  } catch (error) {
    markFailureCooldown(cooldownKey);
    if (options.failOnFetchError) {
      throw new ValidationError(`Unable to refresh Instagram metrics right now (${error.message})`);
    }
    console.warn(`Instagram metrics fetch failed for shortcode ${shortcode}: ${error.message}`);
  }

  return clip;
};

const fetchYouTubeMetricsByVideoId = async (videoId) => {
  if (!YOUTUBE_DATA_API_KEY) {
    throw new Error('YouTube Data API key is missing');
  }
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('YouTube video ID is required');
  }

  const data = await Youtube.videos.list({
    id: videoId,
    part: 'statistics,snippet'
  });

  const item = data?.data?.items?.[0];
  if (!item) {
    throw new Error(`YouTube response did not include data for video ID: ${videoId}`);
  }

  const rawViews = item?.statistics?.viewCount;
  const parsedViewCount = Number.isFinite(Number(rawViews)) ? Number(rawViews) : null;
  const thumbnails = item?.snippet?.thumbnails || {};
  const thumbnailUrl = (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    null
  );

  return {
    videoId,
    thumbnailUrl,
    viewCount: parsedViewCount
  };
};

const refreshYouTubeMetricsForClip = async (clip, options = {}) => {
  if (!config.youtubeSr.enabled) return clip;

  const videoId = clip.youtubeVideoId || extractYouTubeVideoId(clip.clipLink);
  if (!videoId) return clip;

  clip.youtubeVideoId = videoId;
  const cooldownKey = `youtube:${clip.clipId || videoId}`;

  if (!shouldForceRefresh(options) && isInFailureCooldown(cooldownKey)) {
    return clip;
  }

  if (!shouldAttemptRefresh(clip.youtubeMetricsFetchedAt, YOUTUBE_CACHE_TTL_MS, options)) {
    const didSyncViews = syncClipViewsFromExternalMetrics(clip);
    if (didSyncViews) {
      await clip.save();
    }
    return clip;
  }

  try {
    const metrics = await runLimitedMetricRefresh(
      () => fetchYouTubeMetricsByVideoId(videoId),
      options
    );
    if (!metrics) {
      markFailureCooldown(cooldownKey);
      return clip;
    }
    if (metrics.videoId) {
      clip.youtubeVideoId = metrics.videoId;
    }
    clip.youtubeThumbnailUrl = metrics.thumbnailUrl;
    clip.youtubeViewCount = metrics.viewCount;
    clip.youtubeMetricsFetchedAt = new Date();
    syncClipViewsFromExternalMetrics(clip);
    await clip.save();
  } catch (error) {
    markFailureCooldown(cooldownKey);
    if (options.failOnFetchError) {
      throw new ValidationError(`Unable to refresh YouTube metrics right now (${error.message})`);
    }
    console.warn(`YouTube metrics fetch failed for video ${videoId}: ${error.message}`);
  }

  return clip;
};

const refreshExternalMetricsForClip = async (clip, options = {}) => {
  await refreshInstagramMetricsForClip(clip, options);
  await refreshYouTubeMetricsForClip(clip, options);
  if (clip.$locals?.externalViewsChanged) {
    delete clip.$locals.externalViewsChanged;
  }
  return clip;
};

const refreshExternalMetricsForClips = async (clips, options = {}) => {
  if (!Array.isArray(clips) || clips.length === 0) return clips;

  const workers = Math.min(METRICS_MAX_CONCURRENCY, clips.length);
  let currentIndex = 0;

  const runWorker = async () => {
    while (currentIndex < clips.length) {
      const index = currentIndex;
      currentIndex += 1;
      const clip = clips[index];
      await refreshExternalMetricsForClip(clip, options);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return clips;
};

const refreshAllClipsExternalMetrics = async () => {
  const clips = await Clip.find({ status: 'approved' })
    .sort({ instagramMetricsFetchedAt: 1, youtubeMetricsFetchedAt: 1, submittedAt: -1 })
    .limit(METRICS_SCHEDULER_BATCH_SIZE);
  const candidates = clips.filter((clip) => clipNeedsExternalRefresh(clip));
  await refreshExternalMetricsForClips(candidates, {
    rateLimitContext: 'scheduler',
    failOnRateLimit: false,
    failOnFetchError: false
  });
  return candidates.length;
};

// POST /api/clips
const submitClip = async (req, res, next) => {
  try {
    const { campaignId, clipLink, originalVideoLink, clipTimestamps, creatorMessage } = req.body;

    // Verify campaign exists and is live
    const campaign = await Campaign.findOne({ campaignId });
    if (!campaign) throw new NotFoundError('Campaign');
    if (campaign.status !== 'live') {
      throw new ValidationError('Can only submit clips to live campaigns');
    }

    if (!clipLink) {
      throw new ValidationError('Clip link is required');
    }

    if (creatorMessage && creatorMessage.length > 1000) {
      throw new ValidationError('Message too long (max 1000 chars)');
    }

    const normalizedClipLink = clipLink.trim();
    const incomingInstagramShortcode = extractInstagramShortcode(normalizedClipLink);
    const incomingYouTubeId = extractYouTubeVideoId(normalizedClipLink);
    const duplicateFilters = [
      { clipLink: normalizedClipLink }
    ];
    if (incomingInstagramShortcode) {
      duplicateFilters.push({ instagramShortcode: incomingInstagramShortcode });
    }
    if (incomingYouTubeId) {
      duplicateFilters.push({ youtubeVideoId: incomingYouTubeId });
    }

    const existingClip = await Clip.findOne({
      campaignId,
      creatorId: req.user.userId,
      $or: duplicateFilters
    });
    if (existingClip) {
      throw new ValidationError('You have already submitted this clip for this campaign.');
    }

    const clip = await Clip.create({
      clipId: generateId('clip'),
      campaignId,
      creatorId: req.user.userId,
      clipLink: normalizedClipLink,
      originalVideoLink,
      clipTimestamps,
      creatorMessage,
      instagramShortcode: incomingInstagramShortcode,
      youtubeVideoId: incomingYouTubeId,
      status: 'pending'
    });

    await refreshExternalMetricsForClip(clip, {
      forceFetch: true,
      rateLimitContext: 'submit',
      failOnRateLimit: true,
      failOnFetchError: true
    });

    if (clipUsesExternalMetrics(clip)) {
      const resolvedViews = resolveExternalViewsForClip(clip);
      if (resolvedViews === null) {
        await Clip.deleteOne({ clipId: clip.clipId });
        throw new ValidationError('Unable to capture current view count for this reel. Please retry in a minute.');
      }
      clip.views = resolvedViews;
    }

    clip.viewsAtSubmit = Number(clip.views || 0);
    await clip.save();

    res.status(201).json({ clip });
  } catch (error) {
    next(error);
  }
};

// GET /api/clips
const listClips = async (req, res, next) => {
  try {
    const { campaignId, creatorId, status, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (campaignId) filter.campaignId = campaignId;
    if (status) filter.status = status;

    // Creators can only see their own clips
    if (req.user.role === 'creator') {
      filter.creatorId = req.user.userId;
    } else if (creatorId) {
      filter.creatorId = creatorId;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [clips, total] = await Promise.all([
      Clip.find(filter).skip(skip).limit(parseInt(limit)).sort({ submittedAt: -1 }),
      Clip.countDocuments(filter)
    ]);

    const refreshCandidates = getOnDemandRefreshCandidates(clips);
    await refreshExternalMetricsForClips(refreshCandidates, {
      rateLimitContext: 'on_demand',
      failOnRateLimit: false,
      failOnFetchError: false
    });

    res.json({
      clips,
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

// GET /api/clips/:clipId
const getClip = async (req, res, next) => {
  try {
    const clip = await Clip.findOne({ clipId: req.params.clipId });
    if (!clip) throw new NotFoundError('Clip');

    // Creators can only view their own clips
    if (req.user.role === 'creator' && clip.creatorId !== req.user.userId) {
      throw new ForbiddenError('Cannot view another creator\'s clip');
    }

    await refreshExternalMetricsForClip(clip, {
      rateLimitContext: 'on_demand',
      failOnRateLimit: false,
      failOnFetchError: false
    });

    res.json({ clip });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/clips/:clipId/status (admin only - approve/flag)
const updateClipStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const clip = await Clip.findOne({ clipId: req.params.clipId });
    if (!clip) throw new NotFoundError('Clip');

    const validTransitions = {
      pending: ['approved', 'flagged'],
      approved: ['flagged'],
      flagged: ['approved']
    };

    if (!validTransitions[clip.status].includes(status)) {
      throw new ValidationError(`Cannot transition from ${clip.status} to ${status}`);
    }

    if (status === 'approved') {
      await refreshExternalMetricsForClip(clip, {
        forceFetch: true,
        rateLimitContext: 'approval',
        failOnRateLimit: true,
        failOnFetchError: true
      });
      await approveClipWithReservation(clip.clipId, {
        currentViews: clip.views
      });
    } else if (status === 'flagged' && clip.status === 'approved') {
      await releaseClipReservation(clip.clipId, 'admin_flagged');
    } else {
      clip.status = status;
      if (status !== 'approved') {
        clip.earnings = 0;
      }
      await clip.save();
    }

    await recomputeCampaignEarnings(clip.campaignId);
    await recomputeCreatorWallet(clip.creatorId);
    const refreshedClip = await Clip.findOne({ clipId: req.params.clipId });
    res.json({ clip: refreshedClip || clip });
  } catch (error) {
    next(error);
  }
};

// PUT /api/clips/:clipId/views (track views)
const updateViews = async (req, res, next) => {
  try {
    const { views } = req.body;
    if (typeof views !== 'number' || views < 0) {
      throw new ValidationError('Views must be a non-negative number');
    }

    const clip = await Clip.findOne({ clipId: req.params.clipId });
    if (!clip) throw new NotFoundError('Clip');

    if (clip.status !== 'approved') {
      throw new ValidationError('Can only track views on approved clips');
    }

    clip.views = views;
    await clip.save();
    const refreshedClip = await Clip.findOne({ clipId: req.params.clipId });
    res.json({ clip: refreshedClip || clip });
  } catch (error) {
    next(error);
  }
};

// GET /api/clips/creator/:creatorId/analytics
const getCreatorClipAnalytics = async (req, res, next) => {
  try {
    const creatorId = req.params.creatorId || req.user.userId;

    if (req.user.role === 'creator' && req.user.userId !== creatorId) {
      throw new ForbiddenError('Cannot view another creator\'s analytics');
    }

    const clips = await Clip.find({ creatorId });

    const totalViews = clips.reduce((sum, c) => sum + c.views, 0);
    const totalEarnings = clips.reduce((sum, c) => sum + c.earnings, 0);

    res.json({
      creatorId,
      totalClips: clips.length,
      approvedClips: clips.filter(c => c.status === 'approved').length,
      pendingClips: clips.filter(c => c.status === 'pending').length,
      flaggedClips: clips.filter(c => c.status === 'flagged').length,
      totalViews,
      totalEarnings
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/clips/:clipId
const deleteClip = async (req, res, next) => {
  try {
    const clip = await Clip.findOne({ clipId: req.params.clipId });
    if (!clip) throw new NotFoundError('Clip');

    // Only creator (own clips) or admin can delete
    if (req.user.role === 'creator' && clip.creatorId !== req.user.userId) {
      throw new ForbiddenError('Cannot delete another creator\'s clip');
    }

    if (clip.status === 'approved' && req.user.role !== 'admin') {
      throw new ValidationError('Cannot delete an approved clip');
    }

    await Clip.deleteOne({ clipId: req.params.clipId });
    res.json({ message: 'Clip deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  refreshExternalMetricsForClip,
  refreshExternalMetricsForClips,
  refreshAllClipsExternalMetrics,
  submitClip,
  listClips,
  getClip,
  updateClipStatus,
  updateViews,
  getCreatorClipAnalytics,
  deleteClip
};
