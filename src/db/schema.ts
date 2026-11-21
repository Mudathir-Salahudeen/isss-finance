/**
 * Database schema (PostgreSQL, Drizzle ORM).
 *
 * MONEY: every monetary column is a BIGINT holding integer KOBO (1 Naira = 100 kobo).
 * Drizzle maps them to JS numbers ("number" mode); integers are exact up to 2^53,
 * i.e. ~₦90 trillion, far beyond any school's needs. No floating-point maths is used
 * on money anywhere in the application (see src/lib/money.ts).
 */
import {
  pgTable, serial, integer, bigint, text, boolean, timestamp, date, jsonb,
  primaryKey, uniqueIndex, index, bigserial, customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const money = (name: string) => bigint(name, { mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const d = (name: string) => date(name, { mode: "string" });

// ───────────────────────── Settings, users, RBAC ─────────────────────────

export const schoolSettings = pgTable("school_settings", {
  id: integer("id").primaryKey().default(1),
  schoolName: text("school_name").notNull().default("IBN Salahudeen Science School (ISSS)"),
  address: text("address").default(""),
  phone: text("phone").default(""),
  email: text("email").default(""),
  logoPath: text("logo_path"),
  currency: text("currency").notNull().default("NGN"),
  currencySymbol: text("currency_symbol").notNull().default("₦"),
  dateFormat: text("date_format").notNull().default("dd/MM/yyyy"),
  receiptPrefix: text("receipt_prefix").notNull().default("RCT"),
  receiptFooter: text("receipt_footer").default("Thank you for your payment."),
  receiptShowApprover: boolean("receipt_show_approver").notNull().default(true),
  allowSelfApprovalPayments: boolean("allow_self_approval_payments").notNull().default(false),
  allowSelfApprovalExpenses: boolean("allow_self_approval_expenses").notNull().default(false),
  largePaymentThreshold: money("large_payment_threshold").notNull().default(50000000), // ₦500,000
  ageingBands: jsonb("ageing_bands").$type<number[]>().notNull().default(sql`'[30,60,90]'::jsonb`),
  isDemoData: boolean("is_demo_data").notNull().default(false),
  updatedAt: ts("updated_at").defaultNow(),
});

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").default(""),
  isSystem: boolean("is_system").notNull().default(false), // Director role cannot be deleted
  dataScope: text("data_scope").notNull().default("all"), // 'all' | 'own'
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
}, (t) => [primaryKey({ columns: [t.roleId, t.permission] })]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  roleId: integer("role_id").notNull().references(() => roles.id),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: ts("created_at").defaultNow().notNull(),
  lastLoginAt: ts("last_login_at"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  ip: text("ip"),
  success: boolean("success").notNull(),
  at: ts("at").defaultNow().notNull(),
}, (t) => [index("login_attempts_email_at").on(t.email, t.at)]);

// ───────────────────────── Academic structure ─────────────────────────

export const academicSessions = pgTable("academic_sessions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // e.g. 2025/2026
  startDate: d("start_date"),
  endDate: d("end_date"),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const terms = pgTable("terms", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id),
  name: text("name").notNull(), // First Term
  seq: integer("seq").notNull(),
  startDate: d("start_date"),
  endDate: d("end_date"),
  isCurrent: boolean("is_current").notNull().default(false),
}, (t) => [uniqueIndex("terms_session_seq").on(t.sessionId, t.seq)]);

export const classes = pgTable("classes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // JSS 1
  levelOrder: integer("level_order").notNull(),
  nextClassId: integer("next_class_id"), // configurable progression; null + isTerminal = graduates
  isTerminal: boolean("is_terminal").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const arms = pgTable("arms", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => classes.id),
  name: text("name").notNull(), // A, B, Gold
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("arms_class_name").on(t.classId, t.name)]);

// ───────────────────────── Students & enrolment ─────────────────────────

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  admissionNo: text("admission_no").notNull().unique(),
  firstName: text("first_name").notNull(),
  middleName: text("middle_name").default(""),
  lastName: text("last_name").notNull(),
  gender: text("gender").default(""),
  dateOfBirth: d("date_of_birth"),
  status: text("status").notNull().default("active"), // active|graduated|withdrawn|transferred|suspended|archived
  statusDate: d("status_date"),
  statusReason: text("status_reason"),
  guardianName: text("guardian_name").default(""),
  guardianPhone: text("guardian_phone").default(""),
  guardianEmail: text("guardian_email").default(""),
  guardianAddress: text("guardian_address").default(""),
  customFields: jsonb("custom_fields").$type<Record<string, string>>().default({}),
  createdAt: ts("created_at").defaultNow().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  updatedAt: ts("updated_at").defaultNow(),
}, (t) => [index("students_name").on(t.lastName, t.firstName)]);

/** One row per student per academic session. Promotion creates a new row; old rows are never changed in place. */
export const enrolments = pgTable("enrolments", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id),
  classId: integer("class_id").notNull().references(() => classes.id),
  armId: integer("arm_id").references(() => arms.id),
  status: text("status").notNull().default("active"), // active|completed|reversed
  isCurrent: boolean("is_current").notNull().default(true),
  entryType: text("entry_type").notNull().default("admitted"), // admitted|promoted|repeated|imported
  createdAt: ts("created_at").defaultNow().notNull(),
  createdBy: integer("created_by").references(() => users.id),
}, (t) => [
  uniqueIndex("enrolments_student_session_live").on(t.studentId, t.sessionId).where(sql`status <> 'reversed'`),
  index("enrolments_session_class").on(t.sessionId, t.classId),
]);

export const promotionEvents = pgTable("promotion_events", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id"),
  studentId: integer("student_id").notNull().references(() => students.id),
  action: text("action").notNull(), // promoted|repeated|graduated|transferred|withdrawn
  fromEnrolmentId: integer("from_enrolment_id").references(() => enrolments.id),
  toEnrolmentId: integer("to_enrolment_id").references(() => enrolments.id),
  fromSessionId: integer("from_session_id"),
  fromClassId: integer("from_class_id"),
  fromArmId: integer("from_arm_id"),
  toSessionId: integer("to_session_id"),
  toClassId: integer("to_class_id"),
  toArmId: integer("to_arm_id"),
  effectiveDate: d("effective_date"),
  performedBy: integer("performed_by").notNull().references(() => users.id),
  performedAt: ts("performed_at").defaultNow().notNull(),
  reversedAt: ts("reversed_at"),
  reversedBy: integer("reversed_by").references(() => users.id),
  reversalReason: text("reversal_reason"),
});

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // students|staff|fee_assignments|opening_balances
  fileName: text("file_name").notNull(),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  status: text("status").notNull().default("completed"),
  rowResults: jsonb("row_results").$type<{ row: number; outcome: string; message: string; data: Record<string, string> }[]>().default([]),
});

export const importMappings = pgTable("import_mappings", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("import_mappings_kind_name").on(t.kind, t.name)]);

// ───────────────────────── Fees ─────────────────────────

export const feeCategories = pgTable("fee_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
});

export const fees = pgTable("fees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  categoryId: integer("category_id").notNull().references(() => feeCategories.id),
  amount: money("amount").notNull(),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id),
  termId: integer("term_id").references(() => terms.id),
  mandatory: boolean("mandatory").notNull().default(true),
  dueDate: d("due_date"),
  allowPartial: boolean("allow_partial").notNull().default(true),
  recurring: boolean("recurring").notNull().default(false),
  frequency: text("frequency"), // termly|sessional|monthly
  status: text("status").notNull().default("draft"), // draft|active|inactive|cancelled
  isSystem: boolean("is_system").notNull().default(false), // Opening balance fee
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
  cancelledReason: text("cancelled_reason"),
});

export const feeClassAmounts = pgTable("fee_class_amounts", {
  feeId: integer("fee_id").notNull().references(() => fees.id, { onDelete: "cascade" }),
  classId: integer("class_id").notNull().references(() => classes.id),
  amount: money("amount").notNull(),
}, (t) => [primaryKey({ columns: [t.feeId, t.classId] })]);

export const feeAssignments = pgTable("fee_assignments", {
  id: serial("id").primaryKey(),
  feeId: integer("fee_id").notNull().references(() => fees.id),
  scope: jsonb("scope").$type<{ mode: string; classIds?: number[]; armIds?: number[]; studentIds?: number[] }>().notNull(),
  studentCount: integer("student_count").notNull(),
  skippedCount: integer("skipped_count").notNull().default(0),
  totalAmount: money("total_amount").notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** An individual charge on a student's account. Class/arm are snapshotted for historical reporting. */
export const feeCharges = pgTable("fee_charges", {
  id: serial("id").primaryKey(),
  feeId: integer("fee_id").notNull().references(() => fees.id),
  studentId: integer("student_id").notNull().references(() => students.id),
  enrolmentId: integer("enrolment_id").references(() => enrolments.id),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id),
  termId: integer("term_id").references(() => terms.id),
  classId: integer("class_id").references(() => classes.id),
  armId: integer("arm_id").references(() => arms.id),
  amount: money("amount").notNull(),
  dueDate: d("due_date"),
  status: text("status").notNull().default("active"), // active|cancelled
  assignmentId: integer("assignment_id").references(() => feeAssignments.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
  cancelledAt: ts("cancelled_at"),
  cancelledReason: text("cancelled_reason"),
}, (t) => [
  uniqueIndex("fee_charges_fee_student").on(t.feeId, t.studentId), // idempotent assignment
  index("fee_charges_student").on(t.studentId),
]);

export const feeAdjustments = pgTable("fee_adjustments", {
  id: serial("id").primaryKey(),
  chargeId: integer("charge_id").notNull().references(() => feeCharges.id),
  kind: text("kind").notNull(), // waiver|discount|increase
  amount: money("amount").notNull(), // signed delta: negative reduces what the student owes
  reason: text("reason").notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
  reversedAt: ts("reversed_at"),
  reversedBy: integer("reversed_by").references(() => users.id),
  reversalReason: text("reversal_reason"),
});

// ───────────────────────── Accounts & payments ─────────────────────────

export const paymentChannels = pgTable("payment_channels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  requiresReference: boolean("requires_reference").notNull().default(true),
  requiresEvidence: boolean("requires_evidence").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  provider: text("provider").default(""), // bank name
  accountNumber: text("account_number").default(""),
  type: text("type").notNull(), // bank|cash|pos|other
  currency: text("currency").notNull().default("NGN"),
  openingBalance: money("opening_balance").notNull().default(0),
  openingDate: d("opening_date"),
  active: boolean("active").notNull().default(true),
  custodianUserId: integer("custodian_user_id").references(() => users.id), // cashier accountable for a cash account
  restricted: boolean("restricted").notNull().default(false), // if true only users in account_users (or accounts.view_all) can use it
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const accountUsers = pgTable("account_users", {
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.accountId, t.userId] })]);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentNo: text("payment_no").notNull().unique(),
  studentId: integer("student_id").notNull().references(() => students.id),
  enrolmentId: integer("enrolment_id").references(() => enrolments.id),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id),
  termId: integer("term_id").references(() => terms.id),
  amount: money("amount").notNull(),
  paymentDate: d("payment_date").notNull(),
  channelId: integer("channel_id").notNull().references(() => paymentChannels.id),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  reference: text("reference").default(""),
  payerName: text("payer_name").default(""),
  payerContact: text("payer_contact").default(""),
  notes: text("notes").default(""),
  status: text("status").notNull().default("draft"), // draft|pending|approved|rejected|reversed
  recordedBy: integer("recorded_by").notNull().references(() => users.id),
  recordedAt: ts("recorded_at").defaultNow().notNull(),
  submittedAt: ts("submitted_at"),
  decidedBy: integer("decided_by").references(() => users.id),
  decidedAt: ts("decided_at"),
  decisionComment: text("decision_comment"),
  rejectionReason: text("rejection_reason"),
  reversedBy: integer("reversed_by").references(() => users.id),
  reversedAt: ts("reversed_at"),
  reversalReason: text("reversal_reason"),
  possibleDuplicateOf: integer("possible_duplicate_of"),
  duplicateAcknowledgedBy: integer("duplicate_acknowledged_by").references(() => users.id),
  isLarge: boolean("is_large").notNull().default(false),
  idempotencyKey: text("idempotency_key").unique(),
  updatedAt: ts("updated_at").defaultNow(),
}, (t) => [index("payments_status").on(t.status), index("payments_student").on(t.studentId), index("payments_reference").on(t.reference)]);

export const paymentAllocations = pgTable("payment_allocations", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  chargeId: integer("charge_id").notNull().references(() => feeCharges.id),
  amount: money("amount").notNull(),
}, (t) => [uniqueIndex("payment_allocations_payment_charge").on(t.paymentId, t.chargeId)]);

export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  receiptNo: text("receipt_no").notNull().unique(),
  paymentId: integer("payment_id").notNull().unique().references(() => payments.id), // one receipt per payment
  issuedAt: ts("issued_at").defaultNow().notNull(),
  issuedBy: integer("issued_by").notNull().references(() => users.id),
  printCount: integer("print_count").notNull().default(0),
  voided: boolean("voided").notNull().default(false),
});

export const receiptPrints = pgTable("receipt_prints", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id").notNull().references(() => receipts.id),
  printedBy: integer("printed_by").notNull().references(() => users.id),
  printedAt: ts("printed_at").defaultNow().notNull(),
  kind: text("kind").notNull().default("print"), // original|reprint
});

export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // payment|expense|salary_payment|statement
  entityId: integer("entity_id").notNull(),
  fileName: text("file_name").notNull(),
  storedName: text("stored_name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  uploadedAt: ts("uploaded_at").defaultNow().notNull(),
}, (t) => [index("attachments_entity").on(t.entityType, t.entityId)]);

/**
 * The book ledger of every school account. Rows are only ever inserted.
 * (source_type, source_id, kind) is unique so the same event can never post twice.
 */
export const accountTransactions = pgTable("account_transactions", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  txnDate: d("txn_date").notNull(),
  amount: money("amount").notNull(), // signed: + money in, - money out
  kind: text("kind").notNull(), // fee_payment|fee_payment_reversal|expense|expense_reversal|salary|salary_reversal|transfer_in|transfer_out|bank_charge|interest|other_income|other_expense|refund
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  description: text("description").default(""),
  reference: text("reference").default(""),
  categoryName: text("category_name"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("account_txn_source").on(t.sourceType, t.sourceId, t.kind),
  index("account_txn_account_date").on(t.accountId, t.txnDate),
]);

export const transfers = pgTable("transfers", {
  id: serial("id").primaryKey(),
  fromAccountId: integer("from_account_id").notNull().references(() => accounts.id),
  toAccountId: integer("to_account_id").notNull().references(() => accounts.id),
  amount: money("amount").notNull(),
  transferDate: d("transfer_date").notNull(),
  reference: text("reference").default(""),
  notes: text("notes").default(""),
  status: text("status").notNull().default("posted"), // posted|reversed
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
  reversedBy: integer("reversed_by").references(() => users.id),
  reversedAt: ts("reversed_at"),
  reversalReason: text("reversal_reason"),
});

// ───────────────────────── Reconciliation ─────────────────────────

export const bankStatements = pgTable("bank_statements", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  fileName: text("file_name").notNull(),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  uploadedAt: ts("uploaded_at").defaultNow().notNull(),
  periodStart: d("period_start"),
  periodEnd: d("period_end"),
  lineCount: integer("line_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  closingBalance: money("closing_balance"),
});

export const statementLines = pgTable("statement_lines", {
  id: serial("id").primaryKey(),
  statementId: integer("statement_id").notNull().references(() => bankStatements.id),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  lineDate: d("line_date").notNull(),
  description: text("description").default(""),
  reference: text("reference").default(""),
  amount: money("amount").notNull(), // signed: + credit, - debit
  runningBalance: money("running_balance"),
  status: text("status").notNull().default("unmatched"), // unmatched|matched|categorised|ignored|duplicate
  categorisedTxnId: integer("categorised_txn_id"),
  note: text("note"),
}, (t) => [index("statement_lines_account_date").on(t.accountId, t.lineDate)]);

export const reconMatches = pgTable("recon_matches", {
  id: serial("id").primaryKey(),
  statementLineId: integer("statement_line_id").notNull().references(() => statementLines.id),
  accountTxnId: integer("account_txn_id").references(() => accountTransactions.id),
  pendingPaymentId: integer("pending_payment_id").references(() => payments.id), // evidence link only; never approves
  method: text("method").notNull(), // auto|manual
  matchedBy: integer("matched_by").notNull().references(() => users.id),
  matchedAt: ts("matched_at").defaultNow().notNull(),
  active: boolean("active").notNull().default(true),
  unmatchedBy: integer("unmatched_by").references(() => users.id),
  unmatchedAt: ts("unmatched_at"),
});

export const reconciliations = pgTable("reconciliations", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  periodStart: d("period_start").notNull(),
  periodEnd: d("period_end").notNull(),
  statementBalance: money("statement_balance"), // for cash accounts: physically counted cash
  bookBalance: money("book_balance"),
  difference: money("difference"),
  status: text("status").notNull().default("draft"), // draft|in_progress|reconciled|reopened
  notes: text("notes").default(""),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
  reconciledBy: integer("reconciled_by").references(() => users.id),
  reconciledAt: ts("reconciled_at"),
  reopenedBy: integer("reopened_by").references(() => users.id),
  reopenedAt: ts("reopened_at"),
  reopenReason: text("reopen_reason"),
});

// ───────────────────────── Expenses ─────────────────────────

export const expenseCategories = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("expense_categories_name_parent").on(t.name, t.parentId)]);

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  contactPerson: text("contact_person").default(""),
  phone: text("phone").default(""),
  email: text("email").default(""),
  active: boolean("active").notNull().default(true),
});

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  expenseNo: text("expense_no").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").default(""),
  categoryId: integer("category_id").notNull().references(() => expenseCategories.id),
  subcategory: text("subcategory").default(""),
  amount: money("amount").notNull(),
  dateIncurred: d("date_incurred").notNull(),
  vendorId: integer("vendor_id").references(() => vendors.id),
  payeeName: text("payee_name").default(""),
  paymentMethod: text("payment_method").default(""),
  accountId: integer("account_id").references(() => accounts.id), // intended source account
  recurring: boolean("recurring").notNull().default(false),
  recurrence: text("recurrence"),
  department: text("department").default(""),
  status: text("status").notNull().default("draft"), // draft|pending|approved|paid|rejected|cancelled|reversed
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
  submittedAt: ts("submitted_at"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: ts("approved_at"),
  approvalComment: text("approval_comment"),
  rejectedBy: integer("rejected_by").references(() => users.id),
  rejectedAt: ts("rejected_at"),
  rejectionReason: text("rejection_reason"),
  paidBy: integer("paid_by").references(() => users.id),
  paidAt: ts("paid_at"),
  paidDate: d("paid_date"),
  paidAccountId: integer("paid_account_id").references(() => accounts.id),
  paidReference: text("paid_reference"),
  cancelledBy: integer("cancelled_by").references(() => users.id),
  cancelledAt: ts("cancelled_at"),
  cancelReason: text("cancel_reason"),
  idempotencyKey: text("idempotency_key").unique(),
}, (t) => [index("expenses_status").on(t.status)]);

/** Generic approval/workflow history for payments, expenses, payroll. */
export const workflowHistory = pgTable("workflow_history", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actorId: integer("actor_id").notNull().references(() => users.id),
  at: ts("at").defaultNow().notNull(),
  comment: text("comment"),
}, (t) => [index("workflow_history_entity").on(t.entityType, t.entityId)]);

// ───────────────────────── Payroll ─────────────────────────

export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  staffNo: text("staff_no").notNull().unique(),
  fullName: text("full_name").notNull(),
  department: text("department").default(""),
  position: text("position").default(""),
  status: text("status").notNull().default("active"), // active|on_leave|suspended|exited
  startDate: d("start_date"),
  salaryType: text("salary_type").notNull().default("monthly"), // monthly|daily|contract
  bankName: text("bank_name").default(""),
  bankAccountNumber: text("bank_account_number").default(""),
  bankAccountName: text("bank_account_name").default(""),
  phone: text("phone").default(""),
  email: text("email").default(""),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const salaryHistory = pgTable("salary_history", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staff.id),
  basic: money("basic").notNull(),
  effectiveFrom: d("effective_from").notNull(),
  reason: text("reason").notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const staffPayItems = pgTable("staff_pay_items", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staff.id),
  kind: text("kind").notNull(), // allowance|deduction
  name: text("name").notNull(),
  amount: money("amount").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const staffLoans = pgTable("staff_loans", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staff.id),
  kind: text("kind").notNull(), // loan|advance
  principal: money("principal").notNull(),
  monthlyDeduction: money("monthly_deduction").notNull(),
  balance: money("balance").notNull(),
  status: text("status").notNull().default("active"), // active|settled|cancelled
  reason: text("reason").default(""),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const payrollPeriods = pgTable("payroll_periods", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(), // YYYY-MM
  name: text("name").notNull(),
  payDate: d("pay_date"),
  status: text("status").notNull().default("draft"), // draft|pending|approved|partially_paid|paid|rejected|cancelled
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
  submittedAt: ts("submitted_at"),
  submittedBy: integer("submitted_by").references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: ts("approved_at"),
  rejectionReason: text("rejection_reason"),
  notes: text("notes").default(""),
}, (t) => [uniqueIndex("payroll_period_live").on(t.period).where(sql`status <> 'cancelled'`)]);

export const payrollLines = pgTable("payroll_lines", {
  id: serial("id").primaryKey(),
  periodId: integer("period_id").notNull().references(() => payrollPeriods.id),
  staffId: integer("staff_id").notNull().references(() => staff.id),
  basic: money("basic").notNull(),
  allowances: money("allowances").notNull().default(0),
  bonus: money("bonus").notNull().default(0),
  arrears: money("arrears").notNull().default(0),
  deductions: money("deductions").notNull().default(0),
  loanDeduction: money("loan_deduction").notNull().default(0),
  gross: money("gross").notNull(),
  net: money("net").notNull(),
  paidAmount: money("paid_amount").notNull().default(0),
  status: text("status").notNull().default("unpaid"), // unpaid|partially_paid|paid
  notes: text("notes").default(""),
}, (t) => [uniqueIndex("payroll_lines_period_staff").on(t.periodId, t.staffId)]);

export const payrollLineItems = pgTable("payroll_line_items", {
  id: serial("id").primaryKey(),
  lineId: integer("line_id").notNull().references(() => payrollLines.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // allowance|deduction|bonus|arrears|loan
  name: text("name").notNull(),
  amount: money("amount").notNull(),
  loanId: integer("loan_id").references(() => staffLoans.id),
});

export const salaryPayments = pgTable("salary_payments", {
  id: serial("id").primaryKey(),
  lineId: integer("line_id").notNull().references(() => payrollLines.id),
  amount: money("amount").notNull(),
  paymentDate: d("payment_date").notNull(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  reference: text("reference").default(""),
  paidBy: integer("paid_by").notNull().references(() => users.id),
  paidAt: ts("paid_at").defaultNow().notNull(),
  status: text("status").notNull().default("posted"), // posted|reversed
  reversedBy: integer("reversed_by").references(() => users.id),
  reversedAt: ts("reversed_at"),
  reversalReason: text("reversal_reason"),
});

// ───────────────────────── Audit & notifications ─────────────────────────

/** Append-only. UPDATE/DELETE are blocked by a database trigger (see drizzle/0001_audit_guard.sql). */
export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").defaultNow().notNull(),
  userId: integer("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  module: text("module").notNull(),
  recordType: text("record_type"),
  recordId: text("record_id"),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  reason: text("reason"),
  ip: text("ip"),
  userAgent: text("user_agent"),
}, (t) => [index("audit_at").on(t.at), index("audit_record").on(t.recordType, t.recordId)]);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  message: text("message").default(""),
  link: text("link"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [index("notifications_user_unread").on(t.userId, t.isRead)]);

/** Gap-free document counters (receipt numbers etc.), incremented inside the posting transaction. */
export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

/** Uploaded file contents (evidence, logo). Kept in the database so the app runs on serverless hosts with no persistent disk. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
export const fileBlobs = pgTable("file_blobs", {
  storedName: text("stored_name").primaryKey(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** Parsed spreadsheets waiting for the user to map/validate/commit an import (deleted on commit; old rows purged). */
export const importStaging = pgTable("import_staging", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  fileName: text("file_name").notNull(),
  sheet: jsonb("sheet").$type<{ headers: string[]; rows: (string | number | null)[][] }>().notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});
