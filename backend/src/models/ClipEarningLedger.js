const mongoose = require('mongoose');

const clipEarningLedgerSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: {
      values: ['reserve', 'release', 'payout_settle', 'payout_revert', 'migration'],
      message: 'Invalid clip earning ledger event type'
    }
  },
  campaignId: {
    type: String,
    required: [true, 'Campaign ID is required'],
    trim: true
  },
  clipId: {
    type: String,
    required: [true, 'Clip ID is required'],
    trim: true
  },
  creatorId: {
    type: String,
    required: [true, 'Creator ID is required'],
    trim: true
  },
  paymentId: {
    type: String,
    trim: true,
    default: null
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required']
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

clipEarningLedgerSchema.index({ clipId: 1, createdAt: -1 });
clipEarningLedgerSchema.index({ campaignId: 1, createdAt: -1 });
clipEarningLedgerSchema.index({ creatorId: 1, createdAt: -1 });
clipEarningLedgerSchema.index({ paymentId: 1 });
clipEarningLedgerSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model('ClipEarningLedger', clipEarningLedgerSchema);
