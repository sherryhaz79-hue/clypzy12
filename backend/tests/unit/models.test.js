const mongoose = require('mongoose');
const User = require('../../src/models/User');
const Campaign = require('../../src/models/Campaign');
const Clip = require('../../src/models/Clip');
const Payment = require('../../src/models/Payment');
const AdminSettings = require('../../src/models/AdminSettings');

describe('User Model', () => {
  test('should create a valid user', async () => {
    const userData = {
      userId: 'user-test-001',
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123',
      role: 'creator'
    };
    const user = new User(userData);
    const validation = user.validateSync();
    expect(validation).toBeUndefined();
  });

  test('should require email', async () => {
    const user = new User({ userId: 'u1', name: 'Test', password: 'Pass1234', role: 'creator' });
    const validation = user.validateSync();
    expect(validation.errors.email).toBeDefined();
  });

  test('should reject invalid email', async () => {
    const user = new User({
      userId: 'u1', name: 'Test', email: 'invalid', password: 'Pass1234', role: 'creator'
    });
    const validation = user.validateSync();
    expect(validation.errors.email).toBeDefined();
  });

  test('should reject invalid role', async () => {
    const user = new User({
      userId: 'u1', name: 'Test', email: 'test@test.com', password: 'Pass1234', role: 'superuser'
    });
    const validation = user.validateSync();
    expect(validation.errors.role).toBeDefined();
  });

  test('should require name with minimum 2 characters', async () => {
    const user = new User({
      userId: 'u1', name: 'X', email: 'test@test.com', password: 'Pass1234', role: 'creator'
    });
    const validation = user.validateSync();
    expect(validation.errors.name).toBeDefined();
  });

  test('should require password with minimum 8 characters', async () => {
    const user = new User({
      userId: 'u1', name: 'Test', email: 'test@test.com', password: 'short', role: 'creator'
    });
    const validation = user.validateSync();
    expect(validation.errors.password).toBeDefined();
  });

  test('should default wallet balances to 0', () => {
    const user = new User({
      userId: 'u1', name: 'Test', email: 'test@test.com', password: 'Pass1234', role: 'creator'
    });
    expect(user.wallet.availableBalance).toBe(0);
    expect(user.wallet.pendingBalance).toBe(0);
    expect(user.wallet.withdrawableBalance).toBe(0);
  });

  test('should reject negative wallet balances', () => {
    const user = new User({
      userId: 'u1', name: 'Test', email: 'test@test.com', password: 'Pass1234', role: 'creator',
      wallet: { availableBalance: -10 }
    });
    const validation = user.validateSync();
    expect(validation.errors['wallet.availableBalance']).toBeDefined();
  });

  test('toJSON should remove password', () => {
    const user = new User({
      userId: 'u1', name: 'Test', email: 'test@test.com', password: 'Pass1234', role: 'creator'
    });
    const json = user.toJSON();
    expect(json.password).toBeUndefined();
  });
});

describe('Campaign Model', () => {
  test('should create a valid campaign', () => {
    const campaign = new Campaign({
      campaignId: 'camp-001',
      brandId: 'brand-001',
      title: 'Test Campaign Title',
      description: 'This is a test campaign description',
      sourceVideos: ['https://example.com/video.mp4'],
      goalViews: 10000,
      CPM: 5.00,
      deposit: 50,
      minViewsForPayout: 1000,
      status: 'pending'
    });
    const validation = campaign.validateSync();
    expect(validation).toBeUndefined();
  });

  test('should require title with minimum 5 characters', () => {
    const campaign = new Campaign({
      campaignId: 'c1', brandId: 'b1', title: 'Hi',
      description: 'A valid description', sourceVideos: ['url'],
      goalViews: 100, CPM: 1, deposit: 1, minViewsForPayout: 10
    });
    const validation = campaign.validateSync();
    expect(validation.errors.title).toBeDefined();
  });

  test('should reject empty sourceVideos', () => {
    const campaign = new Campaign({
      campaignId: 'c1', brandId: 'b1', title: 'Valid Title',
      description: 'A valid description', sourceVideos: [],
      goalViews: 100, CPM: 1, deposit: 1, minViewsForPayout: 10
    });
    const validation = campaign.validateSync();
    expect(validation.errors.sourceVideos).toBeDefined();
  });

  test('should reject invalid status', () => {
    const campaign = new Campaign({
      campaignId: 'c1', brandId: 'b1', title: 'Valid Title',
      description: 'A valid description', sourceVideos: ['url'],
      goalViews: 100, CPM: 1, deposit: 1, minViewsForPayout: 10,
      status: 'invalid'
    });
    const validation = campaign.validateSync();
    expect(validation.errors.status).toBeDefined();
  });

  test('should default status to pending', () => {
    const campaign = new Campaign({
      campaignId: 'c1', brandId: 'b1', title: 'Valid Title',
      description: 'A valid description', sourceVideos: ['url'],
      goalViews: 100, CPM: 1, deposit: 1, minViewsForPayout: 10
    });
    expect(campaign.status).toBe('pending');
  });
});

describe('Clip Model', () => {
  test('should create a valid clip', () => {
    const clip = new Clip({
      clipId: 'clip-001',
      campaignId: 'camp-001',
      creatorId: 'creator-001',
      clipLink: 'https://tiktok.com/clip',
      originalVideoLink: 'https://example.com/video.mp4',
      status: 'pending'
    });
    const validation = clip.validateSync();
    expect(validation).toBeUndefined();
  });

  test('should default views and earnings to 0', () => {
    const clip = new Clip({
      clipId: 'clip-001', campaignId: 'c1', creatorId: 'cr1',
      clipLink: 'url', originalVideoLink: 'url'
    });
    expect(clip.views).toBe(0);
    expect(clip.earnings).toBe(0);
  });

  test('should validate timestamp format', () => {
    const clip = new Clip({
      clipId: 'clip-001', campaignId: 'c1', creatorId: 'cr1',
      clipLink: 'url', originalVideoLink: 'url',
      clipTimestamps: ['invalid']
    });
    const validation = clip.validateSync();
    expect(validation.errors.clipTimestamps).toBeDefined();
  });

  test('should accept valid timestamps', () => {
    const clip = new Clip({
      clipId: 'clip-001', campaignId: 'c1', creatorId: 'cr1',
      clipLink: 'url', originalVideoLink: 'url',
      clipTimestamps: ['00:01:30', '00:05:00']
    });
    const validation = clip.validateSync();
    expect(validation).toBeUndefined();
  });

  test('should reject negative views', () => {
    const clip = new Clip({
      clipId: 'clip-001', campaignId: 'c1', creatorId: 'cr1',
      clipLink: 'url', originalVideoLink: 'url', views: -5
    });
    const validation = clip.validateSync();
    expect(validation.errors.views).toBeDefined();
  });

  test('should reject negative youtube view count', () => {
    const clip = new Clip({
      clipId: 'clip-001', campaignId: 'c1', creatorId: 'cr1',
      clipLink: 'url', originalVideoLink: 'url', youtubeViewCount: -1
    });
    const validation = clip.validateSync();
    expect(validation.errors.youtubeViewCount).toBeDefined();
  });
});

describe('Payment Model', () => {
  test('should create a valid deposit payment', () => {
    const payment = new Payment({
      paymentId: 'pay-001',
      type: 'deposit',
      campaignId: 'camp-001',
      amount: 100,
      paymentMethod: 'stripe'
    });
    const validation = payment.validateSync();
    expect(validation).toBeUndefined();
  });

  test('should create a valid payout payment', () => {
    const payment = new Payment({
      paymentId: 'pay-002',
      type: 'payout',
      creatorId: 'creator-001',
      amount: 50,
      paymentMethod: 'paypal'
    });
    const validation = payment.validateSync();
    expect(validation).toBeUndefined();
  });

  test('should reject invalid payment type', () => {
    const payment = new Payment({
      paymentId: 'p1', type: 'refund', amount: 10, paymentMethod: 'stripe'
    });
    const validation = payment.validateSync();
    expect(validation.errors.type).toBeDefined();
  });

  test('should reject invalid payment method', () => {
    const payment = new Payment({
      paymentId: 'p1', type: 'deposit', campaignId: 'c1', amount: 10, paymentMethod: 'bitcoin'
    });
    const validation = payment.validateSync();
    expect(validation.errors.paymentMethod).toBeDefined();
  });

  test('should default status to pending', () => {
    const payment = new Payment({
      paymentId: 'p1', type: 'deposit', campaignId: 'c1', amount: 10, paymentMethod: 'stripe'
    });
    expect(payment.status).toBe('pending');
  });
});

describe('AdminSettings Model', () => {
  test('should create valid admin settings', () => {
    const settings = new AdminSettings({
      minCPM: 0.50,
      minViewsForPayout: 1000,
      platformCommissionPercentage: 15,
      payoutSchedule: 'weekly'
    });
    const validation = settings.validateSync();
    expect(validation).toBeUndefined();
  });

  test('should reject commission over 100', () => {
    const settings = new AdminSettings({
      minCPM: 0.50, minViewsForPayout: 1000,
      platformCommissionPercentage: 150, payoutSchedule: 'weekly'
    });
    const validation = settings.validateSync();
    expect(validation.errors.platformCommissionPercentage).toBeDefined();
  });

  test('should reject invalid payout schedule', () => {
    const settings = new AdminSettings({
      minCPM: 0.50, minViewsForPayout: 1000,
      platformCommissionPercentage: 15, payoutSchedule: 'daily'
    });
    const validation = settings.validateSync();
    expect(validation.errors.payoutSchedule).toBeDefined();
  });
});
