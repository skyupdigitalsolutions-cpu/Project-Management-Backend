/**
 * fix-admin-tasks-migration.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE-TIME SCRIPT: Fixes all tasks that were wrongly assigned to admin/manager
 * due to the CASE 4 fallback bug in adaptiveAssignmentEngine.js
 *
 * What it does:
 *  1. Finds all admin/manager users
 *  2. Finds all tasks assigned to them that were AUTO-assigned (is_auto_assigned: true)
 *  3. For each such task, tries to find a matching employee by required_role / required_department
 *  4. If a match is found → reassigns to that employee
 *  5. If no match → sets assigned_to: null, status: "blocked" (needs manual assignment)
 *  6. Prints a full summary at the end
 *
 * HOW TO RUN (from backend root folder):
 *   node fix-admin-tasks-migration.js
 *
 * SAFE TO RE-RUN: already-fixed tasks (assigned_to = employee) are skipped.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/projectManagement';

// ─── Inline minimal schemas (avoids model conflicts) ──────────────────────────

const UserSchema = new mongoose.Schema({
  name:        String,
  email:       String,
  role:        String,
  status:      String,
  department:  String,
  designation: String,
});

const TaskSchema = new mongoose.Schema({
  project_id:          { type: mongoose.Schema.Types.ObjectId },
  assignment_id:       { type: mongoose.Schema.Types.ObjectId },
  title:               String,
  assigned_to:         { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assigned_by:         { type: mongoose.Schema.Types.ObjectId },
  status:              String,
  priority:            String,
  is_auto_assigned:    Boolean,
  required_role:       String,
  required_department: String,
  availability_status: String,
  auto_assign_reason:  String,
  due_date:            Date,
  start_date:          Date,
  end_date:            Date,
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Task = mongoose.models.Task || mongoose.model('Task', TaskSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deptMatch(userDept, targetDept) {
  if (!userDept || !targetDept) return false;
  const u = userDept.toLowerCase();
  const t = targetDept.toLowerCase();
  if (u === t || u.includes(t) || t.includes(u)) return true;
  const tokens = t.split(/[\s&,]+/).filter(tok => tok.length > 2);
  return tokens.some(tok => u.includes(tok));
}

async function findBestEmployee(employees, required_role, required_department) {
  if (!employees.length) return null;

  // Count current active tasks per employee for workload-aware pick
  const withLoad = await Promise.all(
    employees.map(async (u) => {
      const count = await Task.countDocuments({
        assigned_to: u._id,
        status: { $in: ['todo', 'in-progress', 'on-hold'] },
      });
      return { user: u, count };
    })
  );
  withLoad.sort((a, b) => a.count - b.count);

  const roleWords = (required_role || '')
    .split(/[\/\s,]+/)
    .map(w => w.toLowerCase().trim())
    .filter(w => w.length > 2);

  // 1. Best match: designation matches role keyword
  if (roleWords.length > 0) {
    const byRole = withLoad.find(({ user: u }) =>
      roleWords.some(word => u.designation?.toLowerCase().includes(word))
    );
    if (byRole) return byRole.user;
  }

  // 2. Department match
  if (required_department) {
    const byDept = withLoad.find(({ user: u }) =>
      deptMatch(u.department, required_department)
    );
    if (byDept) return byDept.user;
  }

  // 3. Lightest-loaded employee overall
  return withLoad[0].user;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected:', MONGO_URI, '\n');

  // 1. Find all admin/manager user IDs
  const adminUsers = await User.find({ role: { $in: ['admin', 'manager'] } }).select('_id name role');
  if (!adminUsers.length) {
    console.log('ℹ️  No admin/manager users found. Nothing to fix.');
    process.exit(0);
  }
  const adminIds = adminUsers.map(u => u._id);
  console.log(`👤 Admin/Manager users found: ${adminUsers.map(u => `${u.name} (${u.role})`).join(', ')}\n`);

  // 2. Find all auto-assigned tasks where assigned_to is an admin/manager
  const badTasks = await Task.find({
    assigned_to:      { $in: adminIds },
    is_auto_assigned: true,
  }).populate('assigned_to', 'name role');

  console.log(`🔍 Auto-assigned tasks wrongly assigned to admin/manager: ${badTasks.length}\n`);

  if (!badTasks.length) {
    console.log('✅ No bad tasks found. Database is already clean!');
    process.exit(0);
  }

  // 3. Load all active employees once
  const allEmployees = await User.find({ role: 'employee', status: 'active' })
    .select('_id name designation department');
  console.log(`👥 Active employees available for reassignment: ${allEmployees.length}\n`);

  // 4. Fix each bad task
  const results = { reassigned: 0, unassigned: 0, skipped: 0 };
  const detailLog = [];

  for (const task of badTasks) {
    const newAssignee = await findBestEmployee(
      allEmployees,
      task.required_role,
      task.required_department
    );

    if (newAssignee) {
      await Task.findByIdAndUpdate(task._id, {
        $set: {
          assigned_to:         newAssignee._id,
          status:              task.status === 'blocked' ? 'todo' : task.status,
          availability_status: 'assigned',
          auto_assign_reason:  (task.auto_assign_reason || '') + ' [MIGRATED: reassigned from admin]',
        },
      });
      results.reassigned++;
      detailLog.push(`  ✅ "${task.title}" → reassigned to ${newAssignee.name} (${newAssignee.designation || newAssignee.department})`);
    } else {
      await Task.findByIdAndUpdate(task._id, {
        $set: {
          assigned_to:         null,
          status:              'blocked',
          availability_status: 'unassigned',
          auto_assign_reason:  (task.auto_assign_reason || '') + ' [MIGRATED: no employee found, needs manual assignment]',
        },
      });
      results.unassigned++;
      detailLog.push(`  ⚠️  "${task.title}" → left unassigned (role: ${task.required_role || task.required_department || 'N/A'}) — needs manual assignment`);
    }
  }

  // 5. Print summary
  console.log('─'.repeat(60));
  console.log('MIGRATION RESULTS');
  console.log('─'.repeat(60));
  detailLog.forEach(l => console.log(l));
  console.log('─'.repeat(60));
  console.log(`✅ Reassigned to employees : ${results.reassigned}`);
  console.log(`⚠️  Left unassigned (blocked): ${results.unassigned}`);
  console.log(`⏭️  Skipped                  : ${results.skipped}`);
  console.log('─'.repeat(60));
  console.log('\n🎉 Migration complete! Restart your backend server.\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Migration failed:', err.message);
  mongoose.disconnect();
  process.exit(1);
});