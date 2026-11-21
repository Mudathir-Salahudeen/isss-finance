/**
 * Permission catalogue. Roles are configurable in the database (Administration → Roles);
 * these are only the permission keys the code checks, grouped for the role editor.
 * Every server action / API route checks these on the server via `requirePerm`.
 */
export const PERMISSION_GROUPS: { module: string; perms: [string, string][] }[] = [
  { module: "Dashboard", perms: [["dashboard.view", "View dashboard"], ["dashboard.director", "View Director (executive) dashboard"]] },
  { module: "Students", perms: [
    ["students.view", "View students"], ["students.create", "Create students"], ["students.edit", "Edit students / change status"],
    ["students.import", "Bulk import new students"], ["students.import_update", "Bulk import: update existing students"],
    ["students.promote", "Promote / progress students"], ["students.promote_reverse", "Reverse a promotion"],
  ] },
  { module: "Academic setup", perms: [["academics.manage", "Manage sessions, terms, classes, arms & progression"]] },
  { module: "Fees", perms: [
    ["fees.view", "View fees & charges"], ["fees.manage", "Create / edit / cancel fees & categories"],
    ["fees.assign", "Assign fees to students"], ["fees.adjust", "Waivers, discounts & adjustments"],
    ["fees.opening_balance", "Import opening balances"],
  ] },
  { module: "Payments", perms: [
    ["payments.view", "View payments"], ["payments.create", "Record & submit student payments"],
    ["payments.approve", "Approve / reject student payments"], ["payments.reverse", "Reverse approved payments"],
    ["receipts.print", "Print / reprint receipts"],
  ] },
  { module: "Ledger & debtors", perms: [["ledger.view", "View student ledgers & statements"], ["debtors.view", "View debtors"]] },
  { module: "Accounts", perms: [
    ["accounts.view", "View accounts & balances"], ["accounts.view_all", "Use all accounts (ignore account restrictions)"],
    ["accounts.manage", "Create / edit accounts"], ["transfers.create", "Record transfers between accounts"],
  ] },
  { module: "Reconciliation", perms: [
    ["recon.view", "View reconciliations"], ["recon.manage", "Import statements, match, reconcile"], ["recon.reopen", "Reopen a reconciled period"],
  ] },
  { module: "Expenses", perms: [
    ["expenses.view", "View expenses"], ["expenses.create", "Record & submit expenses"], ["expenses.approve", "Approve / reject expenses"],
    ["expenses.pay", "Record expense payment"], ["expenses.cancel", "Cancel / reverse expenses"], ["expenses.manage_categories", "Manage categories & vendors"],
  ] },
  { module: "Payroll", perms: [
    ["payroll.view", "View payroll (sensitive)"], ["payroll.manage_staff", "Manage staff & salary records"],
    ["payroll.prepare", "Generate / adjust / submit payroll"], ["payroll.approve", "Approve payroll"], ["payroll.pay", "Record salary payments"],
  ] },
  { module: "Reports", perms: [
    ["reports.view", "View operational reports"], ["reports.financial", "View financial reports (P&L, analytics)"],
    ["reports.export", "Export reports"], ["reports.export_sensitive", "Export sensitive data (payroll, audit)"],
  ] },
  { module: "Administration", perms: [
    ["users.manage", "Manage users"], ["roles.manage", "Manage roles & permissions"], ["settings.manage", "School settings & policies"],
    ["audit.view", "View audit log"],
  ] },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => p[0]));
export type Permission = (typeof ALL_PERMISSIONS)[number];

/** Default roles created at setup. The Director can edit or create more. */
export const DEFAULT_ROLES: { name: string; description: string; isSystem?: boolean; dataScope?: string; perms: string[] }[] = [
  { name: "Director", description: "Full financial oversight and control.", isSystem: true, perms: ALL_PERMISSIONS },
  {
    name: "Finance / Accountant", description: "Records payments & expenses; reconciles; cannot approve own transactions.",
    perms: ["dashboard.view", "students.view", "fees.view", "fees.assign", "payments.view", "payments.create", "receipts.print",
      "ledger.view", "debtors.view", "accounts.view", "transfers.create", "recon.view", "recon.manage", "expenses.view", "expenses.create",
      "expenses.pay", "reports.view", "reports.export", "payroll.view", "payroll.prepare", "payroll.pay"],
  },
  {
    name: "Cashier", description: "Records cash receipts within scope; prints approved receipts.", dataScope: "own",
    perms: ["dashboard.view", "students.view", "fees.view", "payments.view", "payments.create", "receipts.print", "ledger.view", "accounts.view"],
  },
  {
    name: "School Administrator", description: "Student records, academic structure, imports, fee assignment.",
    perms: ["dashboard.view", "students.view", "students.create", "students.edit", "students.import", "students.promote", "academics.manage",
      "fees.view", "fees.assign", "debtors.view", "reports.view"],
  },
  {
    name: "Auditor", description: "Read-only access to records, reports, audit log and evidence.",
    perms: ["dashboard.view", "dashboard.director", "students.view", "fees.view", "payments.view", "ledger.view", "debtors.view", "accounts.view",
      "recon.view", "expenses.view", "reports.view", "reports.financial", "reports.export", "audit.view"],
  },
];
