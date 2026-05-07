const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const {
  createDeposit,
  createPayout,
  listPayments,
  getPayment,
  updatePaymentStatus,
  getPaymentAudit
} = require('../controllers/payments');

router.use(authenticate);

router.post('/deposit', authorize('brand', 'admin'), createDeposit);
router.post('/payout', authorize('creator', 'admin'), createPayout);
router.get('/', listPayments);
router.get('/audit', authorize('admin'), getPaymentAudit);
router.get('/:paymentId', getPayment);
router.patch('/:paymentId/status', authorize('admin'), updatePaymentStatus);

module.exports = router;
