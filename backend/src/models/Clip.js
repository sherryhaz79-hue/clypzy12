
////backend/src/models/clip.js

const mongoose = require('mongoose');

const clipSchema = new mongoose.Schema({
  clipId: {
    type: String,
    required: [true, 'Clip ID is required'],
    unique: true,
    trim: true
  },
  campaignId: {
    type: String,
    required: [true, 'Campaign ID is required'],
    trim: true
  },
  creatorId: {
    type: String,
    required: [true, 'Creator ID is required'],
    trim: true
  },
  clipLink: {
    type: String,
    required: [true, 'Clip link is required'],
    trim: true
  },
  originalVideoLink: {
    type: String,
    trim: true,
    default: null
  },
  clipTimestamps: {
    type: [String],
    validate: {
      validator: function (v) {
        return v.every(ts => /^\d{2}:\d{2}:\d{2}$/.test(ts));
      },
      message: 'Timestamps must be in HH:MM:SS format'
    }
  },
  creatorMessage: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  views: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Views cannot be negative']
  },
  viewsAtSubmit: {
    type: Number,
    default: null,
    min: [0, 'Submission views cannot be negative']
  },
  viewsAtApproval: {
    type: Number,
    default: null,
    min: [0, 'Approval views cannot be negative']
  },
  eligibleViewsAtApproval: {
    type: Number,
    default: null,
    min: [0, 'Eligible views cannot be negative']
  },
  earnings: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Earnings cannot be negative']
  },
  lockedEarnings: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Locked earnings cannot be negative']
  },
  paidOutAmount: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Paid out amount cannot be negative']
  },
  earningsLocked: {
    type: Boolean,
    required: true,
    default: false
  },
  approvedAt: {
    type: Date,
    default: null
  },
  reservedAt: {
    type: Date,
    default: null
  },
  instagramShortcode: {
    type: String,
    trim: true,
    default: null
  },
  instagramThumbnailUrl: {
    type: String,
    trim: true,
    default: null
  },
  instagramVideoPlayCount: {
    type: Number,
    default: null,
    min: [0, 'Instagram video play count cannot be negative']
  },
  instagramMetricsFetchedAt: {
    type: Date,
    default: null
  },
  youtubeVideoId: {
    type: String,
    trim: true,
    default: null
  },
  youtubeThumbnailUrl: {
    type: String,
    trim: true,
    default: null
  },
  youtubeViewCount: {
    type: Number,
    default: null,
    min: [0, 'YouTube view count cannot be negative']
  },
  youtubeMetricsFetchedAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    required: true,
    enum: {
      values: ['pending', 'approved', 'flagged'],
      message: 'Status must be pending, approved, or flagged'
    },
    default: 'pending'
  },
  submittedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  timestamps: true
});

// Calculate earnings based on views and campaign CPM
clipSchema.methods.calculateEarnings = async function () {
  if (this.earningsLocked) {
    return Number(this.lockedEarnings || 0);
  }

  const Campaign = mongoose.model('Campaign');
  const campaign = await Campaign.findOne({ campaignId: this.campaignId });
  if (campaign) {
    this.earnings = (this.views / 1000) * campaign.CPM;
  }
  return this.earnings;
};

// clipId index auto-created by unique: true
clipSchema.index({ campaignId: 1 });
clipSchema.index({ creatorId: 1 });
clipSchema.index({ status: 1 });
clipSchema.index({ views: -1 });
clipSchema.index({ instagramShortcode: 1 });
clipSchema.index({ youtubeVideoId: 1 });
clipSchema.index({ earningsLocked: 1 });

module.exports = mongoose.model('Clip', clipSchema);
