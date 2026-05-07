
// const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  campaignId: {
    type: String,
    required: [true, 'Campaign ID is required'],
    unique: true,
    trim: true
  },
  brandId: {
    type: String,
    required: [true, 'Brand ID is required'],
    trim: true
  },
  title: {
    type: String,
    required: [true, 'Campaign title is required'],
    trim: true,
    minlength: [5, 'Title must be at least 5 characters']
  },
  description: {
    type: String,
    required: [true, 'Campaign description is required'],
    trim: true,
    minlength: [10, 'Description must be at least 10 characters']
  },
  sourceVideos: {
    type: [String],
    required: [true, 'At least one source video is required'],
    validate: {
      validator: function (v) { return v && v.length > 0; },
      message: 'At least one source video URL is required'
    }
  },
  goalViews: {
    type: Number,
    required: [true, 'Goal views is required'],
    min: [1, 'Goal views must be at least 1'],
    validate: {
      validator: Number.isInteger,
      message: 'Goal views must be an integer'
    }
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    enum: ['USD', 'EUR', 'GBP', 'PKR', 'INR'], // Add the currencies you support
    default: 'USD'
  },
  brandLogo: {
    type: String, 
    required: [false, 'Brand logo is optional'] 
  },
  CPM: {
    type: Number,
    required: [true, 'CPM is required'],
    min: [0.01, 'CPM must be greater than 0']
  },
  deposit: {
    type: Number,
    required: [true, 'Deposit is required'],
    min: [0, 'Deposit cannot be negative']
  },
  budgetReserved: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Reserved budget cannot be negative']
  },
  budgetPaid: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Paid budget cannot be negative']
  },
  minViewsForPayout: {
    type: Number,
    required: [true, 'Minimum views for payout is required'],
    min: [0, 'Minimum views cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: 'Minimum views must be an integer'
    }
  },
  status: {
    type: String,
    required: true,
    enum: {
      values: ['pending', 'live', 'completed', 'rejected'],
      message: 'Status must be pending, live, completed, or rejected'
    },
    default: 'pending'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Validate deposit is sufficient for expected views
campaignSchema.pre('validate', function () {
  if (this.deposit && this.goalViews && this.CPM) {
    const requiredDeposit = (this.goalViews / 1000) * this.CPM;
    if (this.deposit < requiredDeposit) {
      this.invalidate('deposit', `Deposit ($${this.deposit}) must cover goal views cost ($${requiredDeposit.toFixed(2)})`);
    }
  }
});

campaignSchema.virtual('availableBudget').get(function () {
  const deposit = Number(this.deposit || 0);
  const reserved = Number(this.budgetReserved || 0);
  const paid = Number(this.budgetPaid || 0);
  return Math.max(0, deposit - reserved - paid);
});

// campaignId index auto-created by unique: true
campaignSchema.index({ brandId: 1 });
campaignSchema.index({ status: 1 });
campaignSchema.index({ goalViews: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
