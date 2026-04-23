/**
 * requirementInterpreter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts project description + project_type + complexity
 * into a structured list of modules, each containing task drafts.
 *
 * KEY CHANGE: every task now carries required_employee_count
 * so the adaptive assignment engine knows the ideal staffing per task.
 *
 * required_employee_count meaning:
 *   1 = solo task (one specialist)
 *   2 = pair task (e.g. frontend + review, or parallel implementation)
 *   3 = team task (large feature needing multiple hands)
 */

const MODULE_TEMPLATES = {

  website: [
    {
      name: "UI/UX Design",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Wireframes & site structure",     required_role: "designer",           required_department: "Design",          estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "High-fidelity design mockups",    required_role: "designer",           required_department: "Design",          estimated_days: 3, priority: "high",     required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Brand identity & style guide",    required_role: "designer",           required_department: "Design",          estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["large"] },
      ],
    },
    {
      name: "Frontend Development",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Homepage layout & components",    required_role: "frontend developer", required_department: "Web Development", estimated_days: 3, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Navigation & routing setup",      required_role: "frontend developer", required_department: "Web Development", estimated_days: 1, priority: "medium",   required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Responsive design implementation",required_role: "frontend developer", required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Inner pages UI development",      required_role: "frontend developer", required_department: "Web Development", estimated_days: 3, priority: "medium",   required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Animations & micro-interactions", required_role: "frontend developer", required_department: "Web Development", estimated_days: 2, priority: "low",      required_employee_count: 1, complexity: ["large"] },
      ],
    },
    {
      name: "Backend Development",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Project setup & server config",   required_role: "backend developer",  required_department: "Web Development", estimated_days: 1, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Database schema design",          required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["medium","large"] },
        { title: "REST API development",            required_role: "backend developer",  required_department: "Web Development", estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Contact form & email API",        required_role: "backend developer",  required_department: "Web Development", estimated_days: 1, priority: "medium",   required_employee_count: 1, complexity: ["small","medium","large"] },
      ],
    },
    {
      name: "SEO & Launch",
      complexity: ["medium", "large"],
      tasks: [
        { title: "On-page SEO setup",               required_role: "seo specialist",     required_department: "SEO",             estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Performance & speed optimization",required_role: "frontend developer", required_department: "Web Development", estimated_days: 1, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Cross-browser testing & QA",      required_role: "frontend developer", required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 2, complexity: ["large"] },
      ],
    },
  ],

  ecommerce: [
    {
      name: "Authentication",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Login & signup UI",               required_role: "frontend developer", required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Auth API & JWT handling",         required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Password reset flow",             required_role: "backend developer",  required_department: "Web Development", estimated_days: 1, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Social login integration",        required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "low",      required_employee_count: 1, complexity: ["large"] },
      ],
    },
    {
      name: "Product Management",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Product listing page UI",         required_role: "frontend developer", required_department: "Web Development", estimated_days: 3, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Product detail page UI",          required_role: "frontend developer", required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Product CRUD API",                required_role: "backend developer",  required_department: "Web Development", estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["small","medium","large"] },
        { title: "Product filters & search",        required_role: "full stack developer",required_department: "Web Development",estimated_days: 2, priority: "medium",   required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Product image upload & CDN",      required_role: "backend developer",  required_department: "Web Development", estimated_days: 1, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Inventory management system",     required_role: "backend developer",  required_department: "Web Development", estimated_days: 3, priority: "high",     required_employee_count: 3, complexity: ["large"] },
      ],
    },
    {
      name: "Cart & Checkout",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Shopping cart UI",                required_role: "frontend developer", required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Cart management API",             required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Checkout flow UI",                required_role: "frontend developer", required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 2, complexity: ["small","medium","large"] },
        { title: "Address & shipping module",       required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
      ],
    },
    {
      name: "Payment System",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Payment gateway integration",     required_role: "backend developer",  required_department: "Web Development", estimated_days: 3, priority: "critical", required_employee_count: 2, complexity: ["small","medium","large"] },
        { title: "Order confirmation & invoices",   required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Refund & return API",             required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Multi-currency support",          required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "low",      required_employee_count: 1, complexity: ["large"] },
      ],
    },
    {
      name: "Admin Dashboard",
      complexity: ["medium", "large"],
      tasks: [
        { title: "Admin panel UI",                  required_role: "frontend developer", required_department: "Web Development", estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Sales analytics & charts",        required_role: "full stack developer",required_department: "Web Development",estimated_days: 3, priority: "medium",   required_employee_count: 2, complexity: ["medium","large"] },
        { title: "User management module",          required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["large"] },
      ],
    },
    {
      name: "SEO & Marketing",
      complexity: ["medium", "large"],
      tasks: [
        { title: "On-page SEO optimization",        required_role: "seo specialist",     required_department: "SEO",             estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Product schema markup",           required_role: "seo specialist",     required_department: "SEO",             estimated_days: 1, priority: "medium",   required_employee_count: 1, complexity: ["large"] },
      ],
    },
  ],

  mobile_app: [
    {
      name: "UI/UX Design",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "App wireframes & user flow",      required_role: "designer",           required_department: "Design",          estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "High-fidelity screen designs",    required_role: "designer",           required_department: "Design",          estimated_days: 3, priority: "high",     required_employee_count: 1, complexity: ["medium","large"] },
      ],
    },
    {
      name: "Mobile Development",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "App architecture & setup",        required_role: "mobile developer",   required_department: "Mobile",          estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Core screens implementation",     required_role: "mobile developer",   required_department: "Mobile",          estimated_days: 5, priority: "high",     required_employee_count: 2, complexity: ["small","medium","large"] },
        { title: "Push notifications integration",  required_role: "mobile developer",   required_department: "Mobile",          estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Offline mode & caching",          required_role: "mobile developer",   required_department: "Mobile",          estimated_days: 3, priority: "medium",   required_employee_count: 1, complexity: ["large"] },
      ],
    },
    {
      name: "Backend / API",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "REST API for mobile",             required_role: "backend developer",  required_department: "Web Development", estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["small","medium","large"] },
        { title: "Authentication & sessions",       required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Real-time features (WebSocket)",  required_role: "backend developer",  required_department: "Web Development", estimated_days: 3, priority: "medium",   required_employee_count: 2, complexity: ["large"] },
      ],
    },
  ],

  api_service: [
    {
      name: "API Design & Setup",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "API architecture & docs",         required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Authentication & rate limiting",  required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Core endpoint development",       required_role: "backend developer",  required_department: "Web Development", estimated_days: 4, priority: "high",     required_employee_count: 2, complexity: ["small","medium","large"] },
        { title: "Database design & migrations",    required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Testing & API documentation",     required_role: "backend developer",  required_department: "Web Development", estimated_days: 2, priority: "medium",   required_employee_count: 2, complexity: ["medium","large"] },
      ],
    },
  ],

  data_analytics: [
    {
      name: "Data Pipeline",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Data source integration",         required_role: "data analyst",       required_department: "Analytics",       estimated_days: 3, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "ETL pipeline setup",              required_role: "data analyst",       required_department: "Analytics",       estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Dashboard & visualizations",      required_role: "data analyst",       required_department: "Analytics",       estimated_days: 3, priority: "medium",   required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Automated reporting",             required_role: "data analyst",       required_department: "Analytics",       estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["large"] },
      ],
    },
  ],

  seo: [
    {
      name: "SEO Audit & Strategy",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Technical SEO audit",             required_role: "seo specialist",     required_department: "SEO",             estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Keyword research & mapping",      required_role: "seo specialist",     required_department: "SEO",             estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "On-page optimisation",            required_role: "seo specialist",     required_department: "SEO",             estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Content gap analysis",            required_role: "content writer",     required_department: "Content Writing", estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Link building campaign",          required_role: "seo specialist",     required_department: "SEO",             estimated_days: 4, priority: "medium",   required_employee_count: 2, complexity: ["large"] },
      ],
    },
  ],

  marketing: [
    {
      name: "Campaign Strategy",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Campaign brief & planning",       required_role: "marketing specialist",required_department: "Social Media",   estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Content creation & copywriting",  required_role: "content writer",     required_department: "Content Writing", estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["small","medium","large"] },
        { title: "Social media scheduling",         required_role: "marketing specialist",required_department: "Social Media",   estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["medium","large"] },
        { title: "Paid ads setup & management",     required_role: "marketing specialist",required_department: "Social Media",   estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Performance analytics & report",  required_role: "marketing specialist",required_department: "Social Media",   estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["large"] },
      ],
    },
  ],

  design: [
    {
      name: "Design Deliverables",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Brand discovery & moodboard",     required_role: "designer",           required_department: "Design",          estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Logo design concepts",            required_role: "designer",           required_department: "Design",          estimated_days: 3, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Brand identity system",           required_role: "designer",           required_department: "Design",          estimated_days: 3, priority: "high",     required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Marketing collateral design",     required_role: "designer",           required_department: "Design",          estimated_days: 3, priority: "medium",   required_employee_count: 2, complexity: ["large"] },
      ],
    },
  ],

  content: [
    {
      name: "Content Production",
      complexity: ["small", "medium", "large"],
      tasks: [
        { title: "Content strategy & calendar",     required_role: "content writer",     required_department: "Content Writing", estimated_days: 2, priority: "high",     required_employee_count: 1, complexity: ["small","medium","large"] },
        { title: "Blog articles & web copy",        required_role: "content writer",     required_department: "Content Writing", estimated_days: 4, priority: "high",     required_employee_count: 2, complexity: ["small","medium","large"] },
        { title: "Social media content",            required_role: "content writer",     required_department: "Content Writing", estimated_days: 3, priority: "medium",   required_employee_count: 2, complexity: ["medium","large"] },
        { title: "Email marketing sequences",       required_role: "content writer",     required_department: "Content Writing", estimated_days: 2, priority: "medium",   required_employee_count: 1, complexity: ["large"] },
      ],
    },
  ],
};

// ─── Interpreter ──────────────────────────────────────────────────────────────

function interpretRequirements(description, project_type, complexity = "medium") {
  const templates = MODULE_TEMPLATES[project_type] || MODULE_TEMPLATES["website"];

  // Filter modules that apply to this complexity level
  const applicableModules = templates.filter((mod) =>
    mod.complexity.includes(complexity)
  );

  return applicableModules.map((mod) => ({
    name:  mod.name,
    tasks: mod.tasks
      .filter((t) => t.complexity.includes(complexity))
      .map(({ complexity: _c, ...taskFields }) => ({ ...taskFields })), // strip complexity meta
  }));
}

function flattenModulesToDrafts(modules) {
  const drafts = [];
  for (const mod of modules) {
    for (const task of mod.tasks) {
      drafts.push({
        ...task,
        module_name: mod.name,
        // required_employee_count is already on each task from the template
      });
    }
  }
  return drafts;
}

module.exports = { interpretRequirements, flattenModulesToDrafts, MODULE_TEMPLATES };