const config = require('../config');

let globalHits = [];
let onDemandHits = [];

const prune = (hits, windowMs, nowTs) => hits.filter((timestamp) => nowTs - timestamp < windowMs);

const getWindowConfig = () => ({
  globalWindowMs: Math.max(1000, Number(config.externalMetrics.globalWindowMs || 20 * 60 * 1000)),
  globalMax: Math.max(1, Number(config.externalMetrics.maxRequestsPerWindow || 100)),
  onDemandWindowMs: Math.max(1000, Number(config.externalMetrics.onDemandWindowMs || 60 * 1000)),
  onDemandMax: Math.max(1, Number(config.externalMetrics.onDemandMaxRequestsPerWindow || 5))
});

const getMetricsRateSnapshot = () => {
  const nowTs = Date.now();
  const { globalWindowMs, globalMax, onDemandWindowMs, onDemandMax } = getWindowConfig();

  globalHits = prune(globalHits, globalWindowMs, nowTs);
  onDemandHits = prune(onDemandHits, onDemandWindowMs, nowTs);

  return {
    globalUsed: globalHits.length,
    globalRemaining: Math.max(0, globalMax - globalHits.length),
    globalMax,
    onDemandUsed: onDemandHits.length,
    onDemandRemaining: Math.max(0, onDemandMax - onDemandHits.length),
    onDemandMax
  };
};

const acquireMetricsFetchSlot = ({ context = 'scheduler', units = 1 } = {}) => {
  const requested = Math.max(1, Number(units || 1));
  const nowTs = Date.now();
  const {
    globalWindowMs,
    globalMax,
    onDemandWindowMs,
    onDemandMax
  } = getWindowConfig();

  globalHits = prune(globalHits, globalWindowMs, nowTs);
  onDemandHits = prune(onDemandHits, onDemandWindowMs, nowTs);

  const isOnDemand = context === 'on_demand';

  if (globalHits.length + requested > globalMax) {
    return {
      allowed: false,
      reason: 'global_rate_limit_reached',
      snapshot: getMetricsRateSnapshot()
    };
  }

  if (isOnDemand && onDemandHits.length + requested > onDemandMax) {
    return {
      allowed: false,
      reason: 'on_demand_rate_limit_reached',
      snapshot: getMetricsRateSnapshot()
    };
  }

  for (let i = 0; i < requested; i += 1) {
    globalHits.push(nowTs);
    if (isOnDemand) {
      onDemandHits.push(nowTs);
    }
  }

  return {
    allowed: true,
    reason: null,
    snapshot: getMetricsRateSnapshot()
  };
};

module.exports = {
  acquireMetricsFetchSlot,
  getMetricsRateSnapshot
};
