
const DEFAULT_DAILY_HOURS = 8;

// ─── Assignment Type → Subtask Templates ────────────────────────────────────
const ASSIGNMENT_TASK_TEMPLATES = {
  Design: [
    {
      title: "UX Research & User Flows",
      description: "Conduct user research, create personas, and map user journeys",
      required_role: "designer",
      required_department: "Design",
      estimatedHours: 6,
      priority: "high",
    },
    {
      title: "Wireframing & Prototyping",
      description: "Create low-fidelity wireframes and interactive prototypes",
      required_role: "designer",
      required_department: "Design",
      estimatedHours: 8,
      priority: "high",
    },
    {
      title: "UI Design – Screens",
      description: "Design all application screens with consistent design system",
      required_role: "designer",
      required_department: "Design",
      estimatedHours: 10,
      priority: "medium",
    },
    {
      title: "UI Design – Components",
      description: "Build reusable component library (buttons, cards, forms, etc.)",
      required_role: "designer",
      required_department: "Design",
      estimatedHours: 6,
      priority: "medium",
    },
    {
      title: "Design Review & Handoff",
      description: "Finalize designs, create developer handoff specs and assets",
      required_role: "designer",
      required_department: "Design",
      estimatedHours: 4,
      priority: "low",
    },
  ],

  Development: [
    {
      title: "Project Setup & Architecture",
      description: "Initialize repo, configure CI/CD, define folder structure and tech stack",
      required_role: "backend developer",
      required_department: "Web Development",
      estimatedHours: 4,
      priority: "high",
    },
    {
      title: "Database Schema Design",
      description: "Design and implement database models, relationships, and indexes",
      required_role: "backend developer",
      required_department: "Web Development",
      estimatedHours: 5,
      priority: "high",
    },
    {
      title: "API Development",
      description: "Build RESTful APIs – authentication, CRUD operations, business logic",
      required_role: "backend developer",
      required_department: "Web Development",
      estimatedHours: 8,
      priority: "high",
    },
    {
      title: "Frontend Integration",
      description: "Connect React/Vue frontend to backend APIs, handle state management",
      required_role: "frontend developer",
      required_department: "Web Development",
      estimatedHours: 8,
      priority: "medium",
    },
    {
      title: "Authentication & Authorization",
      description: "Implement JWT auth, role-based access control, and session management",
      required_role: "backend developer",
      required_department: "Web Development",
      estimatedHours: 5,
      priority: "high",
    },
    {
      title: "Unit & Integration Testing",
      description: "Write tests for core modules, achieve minimum 70% code coverage",
      required_role: "backend developer",
      required_department: "Web Development",
      estimatedHours: 6,
      priority: "medium",
    },
    {
      title: "Deployment & DevOps",
      description: "Configure server, deploy to production, set up monitoring and logging",
      required_role: "backend developer",
      required_department: "Web Development",
      estimatedHours: 4,
      priority: "low",
    },
  ],

  Testing: [
    {
      title: "Test Plan & Strategy",
      description: "Define test scope, types, tools, and acceptance criteria",
      required_role: "qa engineer",
      required_department: "Testing",
      estimatedHours: 3,
      priority: "high",
    },
    {
      title: "Functional Testing",
      description: "Test all features against requirements – manual and exploratory testing",
      required_role: "qa engineer",
      required_department: "Testing",
      estimatedHours: 6,
      priority: "high",
    },
    {
      title: "Regression Testing",
      description: "Ensure new changes do not break existing functionality",
      required_role: "qa engineer",
      required_department: "Testing",
      estimatedHours: 4,
      priority: "medium",
    },
    {
      title: "Performance & Load Testing",
      description: "Benchmark API response times and system behavior under load",
      required_role: "qa engineer",
      required_department: "Testing",
      estimatedHours: 4,
      priority: "medium",
    },
    {
      title: "Bug Reporting & Tracking",
      description: "Document, prioritize, and track all identified defects",
      required_role: "qa engineer",
      required_department: "Testing",
      estimatedHours: 3,
      priority: "medium",
    },
    {
      title: "UAT – User Acceptance Testing",
      description: "Coordinate UAT sessions with stakeholders, collect sign-off",
      required_role: "qa engineer",
      required_department: "Testing",
      estimatedHours: 4,
      priority: "low",
    },
  ],

  Marketing: [
    {
      title: "Market Research & Competitor Analysis",
      description: "Analyze target audience, market trends, and competitor strategies",
      required_role: "marketing specialist",
      required_department: "Marketing",
      estimatedHours: 5,
      priority: "high",
    },
    {
      title: "Campaign Strategy & Roadmap",
      description: "Define campaign goals, KPIs, channels, and messaging framework",
      required_role: "marketing specialist",
      required_department: "Marketing",
      estimatedHours: 4,
      priority: "high",
    },
    {
      title: "Content Creation – Copy & Assets",
      description: "Write copy, design visuals, and produce marketing collateral",
      required_role: "content writer",
      required_department: "Content Marketing",
      estimatedHours: 8,
      priority: "medium",
    },
    {
      title: "Social Media Setup & Scheduling",
      description: "Create and schedule posts across platforms, configure ad campaigns",
      required_role: "marketing specialist",
      required_department: "Marketing",
      estimatedHours: 5,
      priority: "medium",
    },
    {
      title: "SEO Optimization",
      description: "Keyword research, on-page SEO, meta tags, and content optimization",
      required_role: "seo specialist",
      required_department: "SEO",
      estimatedHours: 6,
      priority: "medium",
    },
    {
      title: "Analytics Setup & Reporting",
      description: "Configure GA4, conversion tracking, and create performance dashboards",
      required_role: "marketing specialist",
      required_department: "Marketing",
      estimatedHours: 4,
      priority: "low",
    },
  ],
};

// ─── Priority sort order ──────────────────────────────────────────────────────
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, critical: -1 };

/**
 * Generate task drafts for a given assignment type.
 */
function generateTasksForAssignment(
  assignmentType,
  parentPriority = "medium",
  dailyWorkHours = DEFAULT_DAILY_HOURS
) {
  const templates = ASSIGNMENT_TASK_TEMPLATES[assignmentType];
  if (!templates) {
    throw new Error(
      `Unknown assignment type: "${assignmentType}". Valid types: ${Object.keys(
        ASSIGNMENT_TASK_TEMPLATES
      ).join(", ")}`
    );
  }

  const shouldInheritPriority =
    parentPriority === "high" || parentPriority === "critical";

  const drafts = templates.map((template) => {
    const effectivePriority = shouldInheritPriority
      ? parentPriority
      : template.priority;

    const estimatedDays = Math.ceil(template.estimatedHours / dailyWorkHours);

    return {
      title: template.title,
      description: template.description,
      required_role: template.required_role,
      required_department: template.required_department,
      estimatedHours: template.estimatedHours,
      estimated_days: estimatedDays,
      priority: effectivePriority,
      assignedDate: null,
      expectedCompletionDate: null,
      status: "pending",
    };
  });

  drafts.sort(
    (a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
  );

  return drafts;
}

/**
 * Get just the template list for a type (for frontend preview — no computation).
 */
function getTemplatesForType(assignmentType) {
  return ASSIGNMENT_TASK_TEMPLATES[assignmentType] || [];
}

/**
 * List all supported assignment types.
 */
function getSupportedTypes() {
  return Object.keys(ASSIGNMENT_TASK_TEMPLATES);
}

// ─── PROJECT TYPE → ASSIGNMENT TYPE MAPPING ───────────────────────────────────
const PROJECT_TYPE_TO_ASSIGNMENT_TYPE = {
  website:          ['Design', 'Development', 'Testing'],
  mobile_app:       ['Design', 'Development', 'Testing'],
  admin_dashboard:  ['Design', 'Development', 'Testing'],
  ecommerce:        ['Design', 'Development', 'Testing'],
  api_service:      ['Development', 'Testing'],
  ai_features:      ['Development', 'Testing'],
  design:           ['Design'],
  marketing:        ['Marketing'],
  seo:              ['Marketing'],
  content:          ['Marketing'],
  data_analytics:   ['Development', 'Testing'],
  other:            ['Development', 'Testing'],
};

// ─── PHASE-BASED PARALLEL PLAN GENERATOR ─────────────────────────────────────
/**
 * Generate a unified, phase-based project plan for multiple project types.
 * Tasks within each phase are organized for maximum parallel execution.
 *
 * PHASE STRUCTURE:
 *  Phase 1: Planning & Research      — kickoff, research, strategy (all parallel)
 *  Phase 2: Design & Strategy        — UI/UX design + SEO research + marketing strategy (parallel)
 *  Phase 3: Development & Setup      — backend, frontend, content creation (parallel streams)
 *  Phase 4: Marketing & Optimization — campaigns, SEO implementation, testing (parallel)
 *  Phase 5: Launch & Monitoring      — deployment, UAT, go-live (sequential handoff)
 *
 * @param {string[]} projectTypes - e.g. ['website', 'seo', 'marketing']
 * @param {string}   description  - project description / requirements text
 * @returns {{ phases: PhaseObject[] }}
 */
function generateUnifiedProjectPlan(projectTypes = [], description = '') {
  if (!projectTypes || projectTypes.length === 0) {
    projectTypes = ['other'];
  }

  const hasWebsite    = projectTypes.some(t => ['website','mobile_app','admin_dashboard','ecommerce'].includes(t));
  const hasDev        = projectTypes.some(t => ['website','mobile_app','admin_dashboard','ecommerce','api_service','ai_features','data_analytics','other'].includes(t));
  const hasDesign     = projectTypes.some(t => ['website','mobile_app','admin_dashboard','ecommerce','design'].includes(t));
  const hasSEO        = projectTypes.some(t => ['seo'].includes(t));
  const hasMarketing  = projectTypes.some(t => ['marketing','seo','content'].includes(t));
  const hasTesting    = projectTypes.some(t => ['website','mobile_app','admin_dashboard','ecommerce','api_service','ai_features','data_analytics','other'].includes(t));

  // ── Phase 1: Planning & Research ─────────────────────────────────────────
  const phase1Tasks = [];

  phase1Tasks.push({
    title: "Project Kickoff & Scope Definition",
    role: "Project Manager",
    duration: "2 days",
    priority: "High",
    dependency: null,
    canRunParallel: false,
  });

  if (hasDesign || hasWebsite) {
    phase1Tasks.push({
      title: "UX Research & User Personas",
      role: "UX Designer",
      duration: "3 days",
      priority: "High",
      dependency: "Project Kickoff & Scope Definition",
      canRunParallel: true,
    });
  }

  if (hasSEO || hasMarketing) {
    phase1Tasks.push({
      title: "SEO Keyword Research & Audit",
      role: "SEO Specialist",
      duration: "3 days",
      priority: "High",
      dependency: "Project Kickoff & Scope Definition",
      canRunParallel: true,
    });
  }

  if (hasMarketing) {
    phase1Tasks.push({
      title: "Market Research & Competitor Analysis",
      role: "Marketing Specialist",
      duration: "3 days",
      priority: "High",
      dependency: "Project Kickoff & Scope Definition",
      canRunParallel: true,
    });
  }

  if (hasDev) {
    phase1Tasks.push({
      title: "Technical Architecture Planning",
      role: "Backend Developer",
      duration: "2 days",
      priority: "High",
      dependency: "Project Kickoff & Scope Definition",
      canRunParallel: true,
    });
  }

  // ── Phase 2: Design & Strategy ────────────────────────────────────────────
  const phase2Tasks = [];

  if (hasDesign) {
    phase2Tasks.push({
      title: "Wireframing & User Flow Design",
      role: "UI/UX Designer",
      duration: "4 days",
      priority: "High",
      dependency: "UX Research & User Personas",
      canRunParallel: true,
    });
    phase2Tasks.push({
      title: "UI Design – Screens & Components",
      role: "UI/UX Designer",
      duration: "5 days",
      priority: "High",
      dependency: "Wireframing & User Flow Design",
      canRunParallel: false,
    });
    phase2Tasks.push({
      title: "Design System & Style Guide",
      role: "UI/UX Designer",
      duration: "3 days",
      priority: "Medium",
      dependency: "Wireframing & User Flow Design",
      canRunParallel: true,
    });
  }

  if (hasSEO || hasMarketing) {
    phase2Tasks.push({
      title: "Content Strategy & Editorial Plan",
      role: hasSEO && hasMarketing ? "SEO & Content Specialist" : (hasSEO ? "SEO Specialist" : "Content Writer"),
      duration: "3 days",
      priority: "High",
      dependency: hasSEO ? "SEO Keyword Research & Audit" : "Market Research & Competitor Analysis",
      canRunParallel: true,
    });
  }

  if (hasMarketing) {
    phase2Tasks.push({
      title: "Campaign Strategy & KPI Definition",
      role: "Marketing Specialist",
      duration: "3 days",
      priority: "High",
      dependency: "Market Research & Competitor Analysis",
      canRunParallel: true,
    });
  }

  if (hasDev) {
    phase2Tasks.push({
      title: "Database Schema & API Design",
      role: "Backend Developer",
      duration: "3 days",
      priority: "High",
      dependency: "Technical Architecture Planning",
      canRunParallel: true,
    });
  }

  // ── Phase 3: Development & Setup ─────────────────────────────────────────
  const phase3Tasks = [];

  if (hasDev) {
    phase3Tasks.push({
      title: "Project Setup & CI/CD Configuration",
      role: "Backend Developer",
      duration: "2 days",
      priority: "High",
      dependency: "Database Schema & API Design",
      canRunParallel: false,
    });
    phase3Tasks.push({
      title: "Backend API Development",
      role: "Backend Developer",
      duration: "7 days",
      priority: "High",
      dependency: "Project Setup & CI/CD Configuration",
      canRunParallel: false,
    });
    phase3Tasks.push({
      title: "Authentication & Authorization",
      role: "Backend Developer",
      duration: "3 days",
      priority: "High",
      dependency: "Project Setup & CI/CD Configuration",
      canRunParallel: true,
    });
  }

  if (hasWebsite || hasDesign) {
    phase3Tasks.push({
      title: "Frontend Development & UI Implementation",
      role: "Frontend Developer",
      duration: "7 days",
      priority: "High",
      dependency: hasDesign ? "UI Design – Screens & Components" : "Project Setup & CI/CD Configuration",
      canRunParallel: true,
    });

    if (hasSEO) {
      phase3Tasks.push({
        title: "Landing Page Development (SEO-Optimised)",
        role: "Frontend Developer",
        duration: "3 days",
        priority: "High",
        dependency: "Frontend Development & UI Implementation",
        canRunParallel: false,
      });
    }
  }

  if (hasMarketing || hasSEO) {
    phase3Tasks.push({
      title: "Content Creation – Copy & Visual Assets",
      role: "Content Writer",
      duration: "5 days",
      priority: "Medium",
      dependency: "Content Strategy & Editorial Plan",
      canRunParallel: true,
    });
    phase3Tasks.push({
      title: "Marketing Campaign Preparation",
      role: "Marketing Specialist",
      duration: "4 days",
      priority: "Medium",
      dependency: "Campaign Strategy & KPI Definition",
      canRunParallel: true,
    });
  }

  // ── Phase 4: Marketing & Optimization ────────────────────────────────────
  const phase4Tasks = [];

  if (hasTesting) {
    phase4Tasks.push({
      title: "Quality Assurance & Functional Testing",
      role: "QA Engineer",
      duration: "4 days",
      priority: "High",
      dependency: hasDev ? "Backend API Development" : null,
      canRunParallel: true,
    });
    phase4Tasks.push({
      title: "Performance & Load Testing",
      role: "QA Engineer",
      duration: "3 days",
      priority: "Medium",
      dependency: "Quality Assurance & Functional Testing",
      canRunParallel: false,
    });
  }

  if (hasSEO) {
    phase4Tasks.push({
      title: "On-Page SEO Implementation",
      role: "SEO Specialist",
      duration: "3 days",
      priority: "High",
      dependency: hasTesting ? "Quality Assurance & Functional Testing" : "Content Creation – Copy & Visual Assets",
      canRunParallel: true,
    });
    phase4Tasks.push({
      title: "Technical SEO Audit & Fixes",
      role: "SEO Specialist",
      duration: "2 days",
      priority: "Medium",
      dependency: "On-Page SEO Implementation",
      canRunParallel: true,
    });
  }

  if (hasMarketing) {
    phase4Tasks.push({
      title: "Social Media Setup & Ad Campaigns",
      role: "Marketing Specialist",
      duration: "3 days",
      priority: "Medium",
      dependency: "Marketing Campaign Preparation",
      canRunParallel: true,
    });
    phase4Tasks.push({
      title: "Analytics & Conversion Tracking Setup",
      role: "Marketing Specialist",
      duration: "2 days",
      priority: "Medium",
      dependency: "Social Media Setup & Ad Campaigns",
      canRunParallel: true,
    });
  }

  if (hasWebsite || hasDev) {
    phase4Tasks.push({
      title: "Frontend–Backend Integration",
      role: "Full Stack Developer",
      duration: "3 days",
      priority: "High",
      dependency: "Backend API Development",
      canRunParallel: true,
    });
  }

  // ── Phase 5: Launch & Monitoring ──────────────────────────────────────────
  const phase5Tasks = [];

  if (hasTesting) {
    phase5Tasks.push({
      title: "User Acceptance Testing (UAT)",
      role: "QA Engineer / Stakeholders",
      duration: "3 days",
      priority: "High",
      dependency: "Performance & Load Testing",
      canRunParallel: false,
    });
  }

  if (hasDev || hasWebsite) {
    phase5Tasks.push({
      title: "Production Deployment & DevOps",
      role: "Backend Developer / DevOps",
      duration: "2 days",
      priority: "High",
      dependency: hasTesting ? "User Acceptance Testing (UAT)" : "Frontend–Backend Integration",
      canRunParallel: false,
    });
  }

  if (hasSEO || hasMarketing) {
    phase5Tasks.push({
      title: "Go-Live Marketing Push & Announcements",
      role: "Marketing Specialist",
      duration: "2 days",
      priority: "High",
      dependency: hasDev ? "Production Deployment & DevOps" : null,
      canRunParallel: true,
    });
  }

  phase5Tasks.push({
    title: "Post-Launch Monitoring & Bug Fixes",
    role: "Full Team",
    duration: "5 days",
    priority: "High",
    dependency: hasDev ? "Production Deployment & DevOps" : null,
    canRunParallel: true,
  });

  if (hasSEO || hasMarketing) {
    phase5Tasks.push({
      title: "Performance Reporting & Optimisation",
      role: "Marketing Specialist / SEO Specialist",
      duration: "3 days",
      priority: "Medium",
      dependency: "Post-Launch Monitoring & Bug Fixes",
      canRunParallel: true,
    });
  }

  return {
    phases: [
      { name: "Phase 1: Planning & Research",      tasks: phase1Tasks },
      { name: "Phase 2: Design & Strategy",        tasks: phase2Tasks },
      { name: "Phase 3: Development & Setup",      tasks: phase3Tasks },
      { name: "Phase 4: Marketing & Optimization", tasks: phase4Tasks },
      { name: "Phase 5: Launch & Monitoring",      tasks: phase5Tasks },
    ].filter(p => p.tasks.length > 0),
  };
}

function generatePlanForTypes(projectTypes = [], requirements = '') {
  const allTasks = [];
  const seenTitles = new Set();

  for (const pType of projectTypes) {
    const assignmentTypes = PROJECT_TYPE_TO_ASSIGNMENT_TYPE[pType] || ['Development'];
    for (const aType of assignmentTypes) {
      const templates = ASSIGNMENT_TASK_TEMPLATES[aType] || [];
      for (const t of templates) {
        if (!seenTitles.has(t.title)) {
          seenTitles.add(t.title);
          allTasks.push({ ...t, source_type: pType, phase: aType });
        }
      }
    }
  }

  const phases = {};
  for (const task of allTasks) {
    if (!phases[task.phase]) phases[task.phase] = [];
    phases[task.phase].push(task);
  }

  return { tasks: allTasks, phases };
}

module.exports = {
  generateTasksForAssignment,
  generateUnifiedProjectPlan,
  generatePlanForTypes,
  getTemplatesForType,
  getSupportedTypes,
  ASSIGNMENT_TASK_TEMPLATES,
  DEFAULT_DAILY_HOURS,
};
