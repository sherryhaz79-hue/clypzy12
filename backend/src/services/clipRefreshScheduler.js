const config = require('../config');
const { refreshAllClipsExternalMetrics } = require('../controllers/clips');
const { recomputePlatformFinancials } = require('./finance');

let timer = null;
let isRunning = false;

const runMetricsAndFinanceCycle = async () => {
  if (isRunning) return;
  isRunning = true;
  const startedAt = Date.now();

  try {
    const refreshedCount = await refreshAllClipsExternalMetrics();
    await recomputePlatformFinancials();
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log(`[scheduler] Metrics and finance cycle completed in ${seconds}s (clips refreshed: ${refreshedCount})`);
  } catch (error) {
    console.error(`[scheduler] Metrics/finance cycle failed: ${error.message}`);
  } finally {
    isRunning = false;
  }
};

const startClipRefreshScheduler = () => {
  if (!config.backgroundJobs.enabled) {
    console.log('[scheduler] Background jobs are disabled');
    return;
  }
  if (timer) return;

  runMetricsAndFinanceCycle();
  timer = setInterval(runMetricsAndFinanceCycle, config.backgroundJobs.clipRefreshIntervalMs);
  console.log(`[scheduler] Started clip refresh scheduler (${config.backgroundJobs.clipRefreshIntervalMs}ms)`);
};

module.exports = {
  startClipRefreshScheduler,
  runMetricsAndFinanceCycle
};
