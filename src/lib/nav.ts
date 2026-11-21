export interface NavItem { href: string; label: string; perms: string[] }
export interface NavGroup { label: string; items: NavItem[] }

/** Sidebar: each link is shown only if the user holds at least one of its permissions (the server also enforces them). */
export const NAV: NavGroup[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", perms: ["dashboard.view"] }, { href: "/notifications", label: "Notifications", perms: [] }] },
  { label: "Students", items: [
    { href: "/students", label: "Student list", perms: ["students.view"] },
    { href: "/imports/new?kind=students", label: "Bulk import", perms: ["students.import"] },
    { href: "/promotion", label: "Promotion", perms: ["students.promote"] },
    { href: "/academics", label: "Classes & sessions", perms: ["academics.manage"] },
  ] },
  { label: "Fees", items: [
    { href: "/fees", label: "Fee setup", perms: ["fees.view"] },
    { href: "/payments/new", label: "Record payment", perms: ["payments.create"] },
    { href: "/payments?status=pending", label: "Pending approvals", perms: ["payments.view", "payments.approve"] },
    { href: "/payments", label: "Payments & receipts", perms: ["payments.view", "payments.approve"] },
    { href: "/debtors", label: "Debtors", perms: ["debtors.view"] },
  ] },
  { label: "Accounts", items: [
    { href: "/accounts", label: "Bank & cash accounts", perms: ["accounts.view"] },
    { href: "/accounts/transfers", label: "Transfers", perms: ["accounts.view"] },
    { href: "/reconciliation", label: "Reconciliation", perms: ["recon.view"] },
  ] },
  { label: "Expenses", items: [
    { href: "/expenses", label: "Expenses", perms: ["expenses.view", "expenses.create", "expenses.approve"] },
    { href: "/expenses/new", label: "Record expense", perms: ["expenses.create"] },
    { href: "/expenses/categories", label: "Categories & vendors", perms: ["expenses.manage_categories"] },
  ] },
  { label: "Payroll", items: [
    { href: "/payroll", label: "Staff", perms: ["payroll.view"] },
    { href: "/payroll/periods", label: "Payroll periods", perms: ["payroll.view"] },
  ] },
  { label: "Reports", items: [
    { href: "/reports", label: "All reports", perms: ["reports.view", "reports.financial"] },
    { href: "/reports/pnl", label: "Income & expenditure", perms: ["reports.financial"] },
    { href: "/reports/revenue", label: "Revenue analysis", perms: ["reports.financial"] },
    { href: "/reports/expenses", label: "Expense analysis", perms: ["reports.financial"] },
  ] },
  { label: "Administration", items: [
    { href: "/admin/users", label: "Users", perms: ["users.manage"] },
    { href: "/admin/roles", label: "Roles & permissions", perms: ["roles.manage"] },
    { href: "/admin/settings", label: "School settings", perms: ["settings.manage"] },
    { href: "/imports", label: "Imports & templates", perms: ["students.import", "payroll.manage_staff", "fees.assign", "fees.opening_balance"] },
    { href: "/audit", label: "Audit log", perms: ["audit.view"] },
  ] },
];
