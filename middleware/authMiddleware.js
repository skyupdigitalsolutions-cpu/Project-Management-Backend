/**
 * middleware/authMiddleware.js
 *
 * protect   — verifies JWT from Authorization header, attaches full user to req.user
 * authorise — role-based access guard, must be called after protect()
 */

const jwt  = require('jsonwebtoken');
const User = require('../models/users');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorised, no token' });
    }

    const token   = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }
    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'Account is inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

/**
 * Usage: authorise('admin', 'manager')
 * Returns a middleware — must be invoked with roles, not passed bare.
 */
const authorise = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Role '${req.user.role}' is not permitted to perform this action`,
    });
  }
  next();
};

module.exports = { protect, authorise };