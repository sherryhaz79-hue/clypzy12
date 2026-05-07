
//backend/src/controllers/users.js

const User = require('../models/User');
const { generateToken } = require('../middleware/auth');
const generateId = require('../utils/generateId');
const { recomputeCreatorWallet } = require('../services/finance');
const { NotFoundError, ValidationError, ConflictError, AuthenticationError } = require('../utils/errors');

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    const userRole = role || 'creator';

    // Check if email+role combination already exists
    const existing = await User.findOne({ email, role: userRole });
    if (existing) {
      throw new ConflictError(`This email is already registered as a ${userRole}`);
    }

    const user = await User.create({
      userId: generateId('user'),
      name,
      email,
      password,
      role: userRole
    });

    const token = generateToken(user);
    res.status(201).json({ user, token });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password, role } = req.body;

    // If role is provided, find user with that specific role
    const query = role ? { email, role } : { email };
    const user = await User.findOne(query).select('+password');

    if (!user) {
      if (role) {
        // Check if user exists with different role
        const userWithDifferentRole = await User.findOne({ email });
        if (userWithDifferentRole) {
          throw new AuthenticationError(`No ${role} account found with this email. Please sign up as a ${role} or login with your ${userWithDifferentRole.role} account.`);
        }
      }
      throw new AuthenticationError('Invalid email or password');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new AuthenticationError('Invalid email or password');
    }

    const token = generateToken(user);
    res.json({ user: user.toJSON(), token });
  } catch (error) {
    next(error);
  }
};

// GET /api/users/me
const getProfile = async (req, res, next) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    next(error);
  }
};

// PUT /api/users/me
const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = ['name', 'socialAccounts'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      updates,
      { new: true, runValidators: true }
    );

    res.json({ user });
  } catch (error) {
    next(error);
  }
};

// GET /api/users (admin)
const listUsers = async (req, res, next) => {
  try {
    const { role, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (role) filter.role = role;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      User.countDocuments(filter)
    ]);

    res.json({
      users,
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

// GET /api/users/:userId
const getUser = async (req, res, next) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) throw new NotFoundError('User');
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

// PUT /api/users/:userId (admin)
const updateUser = async (req, res, next) => {
  try {
    const allowedFields = ['name', 'role', 'isActive'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const user = await User.findOneAndUpdate(
      { userId: req.params.userId },
      updates,
      { new: true, runValidators: true }
    );

    if (!user) throw new NotFoundError('User');
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/users/:userId (admin - soft delete)
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findOneAndUpdate(
      { userId: req.params.userId },
      { isActive: false },
      { new: true }
    );
    if (!user) throw new NotFoundError('User');
    res.json({ message: 'User deactivated', user });
  } catch (error) {
    next(error);
  }
};

// GET /api/users/:userId/wallet
const getWallet = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.user.userId;

    // Users can only view their own wallet, admins can view any
    if (req.user.role !== 'admin' && req.user.userId !== targetUserId) {
      throw new require('../utils/errors').ForbiddenError('Cannot view another user\'s wallet');
    }

    const user = await User.findOne({ userId: targetUserId });
    if (!user) throw new NotFoundError('User');
    if (user.role === 'creator') {
      await recomputeCreatorWallet(targetUserId);
    }
    const refreshedUser = await User.findOne({ userId: targetUserId });
    if (!refreshedUser) throw new NotFoundError('User');

    res.json({ wallet: refreshedUser.wallet });
  } catch (error) {
    next(error);
  }
};

// POST /api/users/:userId/social (link social account)
// const linkSocialAccount = async (req, res, next) => {
//   try {
//     const { platform, accountId } = req.body;
//     const validPlatforms = ['instagram', 'tiktok', 'youtube'];

//     if (!validPlatforms.includes(platform)) {
//       throw new ValidationError(`Platform must be one of: ${validPlatforms.join(', ')}`);
//     }

//     const update = {};
//     update[`socialAccounts.${platform}`] = accountId;

//     const user = await User.findOneAndUpdate(
//       { userId: req.user.userId },
//       update,
//       { new: true, runValidators: true }
//     );

//     if (!user) throw new NotFoundError('User');
//     res.json({ user });
//   } catch (error) {
//     next(error);
//   }
// };


const linkSocialAccount = async (req, res, next) => {
  try {
    const { platform, accountId } = req.body;
    const validPlatforms = ['instagram', 'tiktok', 'youtube'];
    if (!validPlatforms.includes(platform)) {
      throw new ValidationError(`Platform must be one of: ${validPlatforms.join(', ')}`);
    }

    const cleanHandle = accountId.replace(/@/g, '').trim();

    if (!cleanHandle) {
      const update = { [`socialAccounts.${platform}`]: null };
      const user = await User.findOneAndUpdate({ userId: req.user.userId }, update, { new: true });
      return res.json({ user });
    }

    // Temporary bypass: accept submitted handles without external verification.

    // SUCCESS: Save to MongoDB
    const update = { [`socialAccounts.${platform}`]: cleanHandle };
    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      update,
      { new: true, runValidators: true }
    );

    res.json({ user });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  getWallet,
  linkSocialAccount
};
