/**
 * services/workloadCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin in-memory cache for user workload scores.
 *
 * WHY:
 *   autoAssignService.getUserWorkloadScore() hits the DB for every candidate
 *   during assignment. When assigning 10+ tasks simultaneously we'd hit the DB
 *   50-100 times for the same users. This cache reduces that to 1 query per
 *   user per TTL window.
 *
 * DESIGN:
 *   - Simple Map-based cache with per-entry TTL (default 60 seconds)
 *   - Entries are invalidated explicitly when a task is created/updated
 *   - Falls back to a live DB query on cache miss (transparent to callers)
 *   - Thread-safe for Node's single-threaded event loop
 *
 * USAGE:
 *   const workloadCache = require('./workloadCache');
 *
 *   // Get score (cached or fresh)
 *   const score = await workloadCache.getScore(userId);
 *
 *   // Invalidate after a task assignment
 *   workloadCache.invalidate(userId);
 *
 *   // Invalidate multiple users at once
 *   workloadCache.invalidateMany([userId1, userId2]);
 *
 *   // Pre-warm cache for a set of users (batch DB query)
 *   await workloadCache.warmUp([userId1, userId2, userId3]);
 */

const Task = require('../models/tasks');

const PRIORITY_SCORE = { critical: 100, high: 75, medium: 50, low: 25 };

// Cache entry: { score: number, expiresAt: number }
const _cache = new Map();

// Default TTL in milliseconds
const DEFAULT_TTL_MS = 60_000; // 60 seconds

// ─── Internal DB fetch ────────────────────────────────────────────────────────

async function _fetchScoreFromDB(userId) {
  const tasks = await Task.find({
    assigned_to: userId,
    status: { $in: ['todo', 'in-progress', 'on-hold'] },
  }).select('priority').lean();

  return tasks.reduce((total, t) => total + (PRIORITY_SCORE[t.priority] || 0), 0);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get workload score for a user.
 * Returns cached value if fresh, otherwise queries DB and caches the result.
 *
 * @param {string|ObjectId} userId
 * @param {number} ttlMs - optional custom TTL
 * @returns {Promise<number>}
 */
async function getScore(userId, ttlMs = DEFAULT_TTL_MS) {
  const key = userId.toString();
  const now = Date.now();
  const cached = _cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.score;
  }

  const score = await _fetchScoreFromDB(userId);
  _cache.set(key, { score, expiresAt: now + ttlMs });
  return score;
}

/**
 * Invalidate cache for one user.
 * Call this immediately after assigning/removing a task from this user.
 *
 * @param {string|ObjectId} userId
 */
function invalidate(userId) {
  _cache.delete(userId.toString());
}

/**
 * Invalidate cache for multiple users at once.
 *
 * @param {Array<string|ObjectId>} userIds
 */
function invalidateMany(userIds) {
  for (const id of userIds) {
    _cache.delete(id.toString());
  }
}

/**
 * Pre-warm cache for a list of users using a single aggregation query.
 * Call this before a batch assignment loop to avoid N individual DB hits.
 *
 * @param {Array<string|ObjectId>} userIds
 * @param {number} ttlMs
 */
async function warmUp(userIds, ttlMs = DEFAULT_TTL_MS) {
  if (!userIds || userIds.length === 0) return;

  const now = Date.now();

  // Single aggregation for all users at once
  const results = await Task.aggregate([
    {
      $match: {
        assigned_to: { $in: userIds.map((id) => id.toString ? id : id) },
        status: { $in: ['todo', 'in-progress', 'on-hold'] },
      },
    },
    {
      $group: {
        _id: '$assigned_to',
        score: {
          $sum: {
            $switch: {
              branches: [
                { case: { $eq: ['$priority', 'critical'] }, then: 100 },
                { case: { $eq: ['$priority', 'high'] },     then: 75 },
                { case: { $eq: ['$priority', 'medium'] },   then: 50 },
                { case: { $eq: ['$priority', 'low'] },      then: 25 },
              ],
              default: 0,
            },
          },
        },
      },
    },
  ]);

  // Build a result map
  const scoreMap = new Map(results.map((r) => [r._id.toString(), r.score]));

  // Store in cache — users with no tasks get score 0
  for (const userId of userIds) {
    const key = userId.toString();
    _cache.set(key, {
      score:     scoreMap.get(key) ?? 0,
      expiresAt: now + ttlMs,
    });
  }
}

/**
 * Clear the entire cache (useful in tests or after bulk operations).
 */
function clear() {
  _cache.clear();
}

/**
 * Return cache stats (for debugging/monitoring).
 */
function stats() {
  const now = Date.now();
  let fresh = 0, stale = 0;
  for (const entry of _cache.values()) {
    entry.expiresAt > now ? fresh++ : stale++;
  }
  return { total: _cache.size, fresh, stale };
}

module.exports = { getScore, invalidate, invalidateMany, warmUp, clear, stats };