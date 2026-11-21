CREATE TABLE "academic_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_sessions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "account_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"txn_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer NOT NULL,
	"description" text DEFAULT '',
	"reference" text DEFAULT '',
	"category_name" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_users" (
	"account_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "account_users_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT '',
	"account_number" text DEFAULT '',
	"type" text NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"opening_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"custodian_user_id" integer,
	"restricted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "arms" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"user_name" text,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"record_type" text,
	"record_id" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"reason" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period_start" date,
	"period_end" date,
	"line_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"closing_balance" bigint
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"level_order" integer NOT NULL,
	"next_class_id" integer,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "classes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "enrolments" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"arm_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"entry_type" text DEFAULT 'admitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_no" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '',
	"category_id" integer NOT NULL,
	"subcategory" text DEFAULT '',
	"amount" bigint NOT NULL,
	"date_incurred" date NOT NULL,
	"vendor_id" integer,
	"payee_name" text DEFAULT '',
	"payment_method" text DEFAULT '',
	"account_id" integer,
	"recurring" boolean DEFAULT false NOT NULL,
	"recurrence" text,
	"department" text DEFAULT '',
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"approval_comment" text,
	"rejected_by" integer,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"paid_by" integer,
	"paid_at" timestamp with time zone,
	"paid_date" date,
	"paid_account_id" integer,
	"paid_reference" text,
	"cancelled_by" integer,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"idempotency_key" text,
	CONSTRAINT "expenses_expense_no_unique" UNIQUE("expense_no"),
	CONSTRAINT "expenses_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "fee_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"charge_id" integer NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	"reversal_reason" text
);
--> statement-breakpoint
CREATE TABLE "fee_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"fee_id" integer NOT NULL,
	"scope" jsonb NOT NULL,
	"student_count" integer NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"total_amount" bigint NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fee_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "fee_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"fee_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"enrolment_id" integer,
	"session_id" integer NOT NULL,
	"term_id" integer,
	"class_id" integer,
	"arm_id" integer,
	"amount" bigint NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"assignment_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text
);
--> statement-breakpoint
CREATE TABLE "fee_class_amounts" (
	"fee_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "fee_class_amounts_fee_id_class_id_pk" PRIMARY KEY("fee_id","class_id")
);
--> statement-breakpoint
CREATE TABLE "fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"category_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"session_id" integer NOT NULL,
	"term_id" integer,
	"mandatory" boolean DEFAULT true NOT NULL,
	"due_date" date,
	"allow_partial" boolean DEFAULT true NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"frequency" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_reason" text
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"row_results" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "import_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip" text,
	"success" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"message" text DEFAULT '',
	"link" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"charge_id" integer NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"requires_reference" boolean DEFAULT true NOT NULL,
	"requires_evidence" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "payment_channels_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_no" text NOT NULL,
	"student_id" integer NOT NULL,
	"enrolment_id" integer,
	"session_id" integer NOT NULL,
	"term_id" integer,
	"amount" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"channel_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"reference" text DEFAULT '',
	"payer_name" text DEFAULT '',
	"payer_contact" text DEFAULT '',
	"notes" text DEFAULT '',
	"status" text DEFAULT 'draft' NOT NULL,
	"recorded_by" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"rejection_reason" text,
	"reversed_by" integer,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"possible_duplicate_of" integer,
	"duplicate_acknowledged_by" integer,
	"is_large" boolean DEFAULT false NOT NULL,
	"idempotency_key" text,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "payments_payment_no_unique" UNIQUE("payment_no"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payroll_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"line_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"loan_id" integer
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"basic" bigint NOT NULL,
	"allowances" bigint DEFAULT 0 NOT NULL,
	"bonus" bigint DEFAULT 0 NOT NULL,
	"arrears" bigint DEFAULT 0 NOT NULL,
	"deductions" bigint DEFAULT 0 NOT NULL,
	"loan_deduction" bigint DEFAULT 0 NOT NULL,
	"gross" bigint NOT NULL,
	"net" bigint NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"notes" text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"name" text NOT NULL,
	"pay_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" integer,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"notes" text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE "promotion_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" text,
	"student_id" integer NOT NULL,
	"action" text NOT NULL,
	"from_enrolment_id" integer,
	"to_enrolment_id" integer,
	"from_session_id" integer,
	"from_class_id" integer,
	"from_arm_id" integer,
	"to_session_id" integer,
	"to_class_id" integer,
	"to_arm_id" integer,
	"effective_date" date,
	"performed_by" integer NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	"reversal_reason" text
);
--> statement-breakpoint
CREATE TABLE "receipt_prints" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"printed_by" integer NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text DEFAULT 'print' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_no" text NOT NULL,
	"payment_id" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" integer NOT NULL,
	"print_count" integer DEFAULT 0 NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	CONSTRAINT "receipts_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "receipts_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "recon_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_line_id" integer NOT NULL,
	"account_txn_id" integer,
	"pending_payment_id" integer,
	"method" text NOT NULL,
	"matched_by" integer NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"unmatched_by" integer,
	"unmatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"statement_balance" bigint,
	"book_balance" bigint,
	"difference" bigint,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text DEFAULT '',
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciled_by" integer,
	"reconciled_at" timestamp with time zone,
	"reopened_by" integer,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"is_system" boolean DEFAULT false NOT NULL,
	"data_scope" text DEFAULT 'all' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "salary_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"basic" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"line_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"account_id" integer NOT NULL,
	"reference" text DEFAULT '',
	"paid_by" integer NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversed_by" integer,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text
);
--> statement-breakpoint
CREATE TABLE "school_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"school_name" text DEFAULT 'My School' NOT NULL,
	"address" text DEFAULT '',
	"phone" text DEFAULT '',
	"email" text DEFAULT '',
	"logo_path" text,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"currency_symbol" text DEFAULT '₦' NOT NULL,
	"date_format" text DEFAULT 'dd/MM/yyyy' NOT NULL,
	"receipt_prefix" text DEFAULT 'RCT' NOT NULL,
	"receipt_footer" text DEFAULT 'Thank you for your payment.',
	"receipt_show_approver" boolean DEFAULT true NOT NULL,
	"allow_self_approval_payments" boolean DEFAULT false NOT NULL,
	"allow_self_approval_expenses" boolean DEFAULT false NOT NULL,
	"large_payment_threshold" bigint DEFAULT 50000000 NOT NULL,
	"ageing_bands" jsonb DEFAULT '[30,60,90]'::jsonb NOT NULL,
	"is_demo_data" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_no" text NOT NULL,
	"full_name" text NOT NULL,
	"department" text DEFAULT '',
	"position" text DEFAULT '',
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date,
	"salary_type" text DEFAULT 'monthly' NOT NULL,
	"bank_name" text DEFAULT '',
	"bank_account_number" text DEFAULT '',
	"bank_account_name" text DEFAULT '',
	"phone" text DEFAULT '',
	"email" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_staff_no_unique" UNIQUE("staff_no")
);
--> statement-breakpoint
CREATE TABLE "staff_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"kind" text NOT NULL,
	"principal" bigint NOT NULL,
	"monthly_deduction" bigint NOT NULL,
	"balance" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text DEFAULT '',
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_pay_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"line_date" date NOT NULL,
	"description" text DEFAULT '',
	"reference" text DEFAULT '',
	"amount" bigint NOT NULL,
	"running_balance" bigint,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"categorised_txn_id" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"admission_no" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text DEFAULT '',
	"last_name" text NOT NULL,
	"gender" text DEFAULT '',
	"date_of_birth" date,
	"status" text DEFAULT 'active' NOT NULL,
	"status_date" date,
	"status_reason" text,
	"guardian_name" text DEFAULT '',
	"guardian_phone" text DEFAULT '',
	"guardian_email" text DEFAULT '',
	"guardian_address" text DEFAULT '',
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "students_admission_no_unique" UNIQUE("admission_no")
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"name" text NOT NULL,
	"seq" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_account_id" integer NOT NULL,
	"to_account_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"transfer_date" date NOT NULL,
	"reference" text DEFAULT '',
	"notes" text DEFAULT '',
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by" integer,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_person" text DEFAULT '',
	"phone" text DEFAULT '',
	"email" text DEFAULT '',
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vendors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "workflow_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text
);
--> statement-breakpoint
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_users" ADD CONSTRAINT "account_users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_users" ADD CONSTRAINT "account_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_custodian_user_id_users_id_fk" FOREIGN KEY ("custodian_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arms" ADD CONSTRAINT "arms_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_session_id_academic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_arm_id_arms_id_fk" FOREIGN KEY ("arm_id") REFERENCES "public"."arms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_account_id_accounts_id_fk" FOREIGN KEY ("paid_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_charge_id_fee_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."fee_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_fee_id_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."fees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_fee_id_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."fees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_session_id_academic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_arm_id_arms_id_fk" FOREIGN KEY ("arm_id") REFERENCES "public"."arms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_assignment_id_fee_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."fee_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_class_amounts" ADD CONSTRAINT "fee_class_amounts_fee_id_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."fees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_class_amounts" ADD CONSTRAINT "fee_class_amounts_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_category_id_fee_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."fee_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_session_id_academic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_charge_id_fee_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."fee_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_academic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_channel_id_payment_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."payment_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_duplicate_acknowledged_by_users_id_fk" FOREIGN KEY ("duplicate_acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_line_id_payroll_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_loan_id_staff_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."staff_loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_from_enrolment_id_enrolments_id_fk" FOREIGN KEY ("from_enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_to_enrolment_id_enrolments_id_fk" FOREIGN KEY ("to_enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_printed_by_users_id_fk" FOREIGN KEY ("printed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_matches" ADD CONSTRAINT "recon_matches_statement_line_id_statement_lines_id_fk" FOREIGN KEY ("statement_line_id") REFERENCES "public"."statement_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_matches" ADD CONSTRAINT "recon_matches_account_txn_id_account_transactions_id_fk" FOREIGN KEY ("account_txn_id") REFERENCES "public"."account_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_matches" ADD CONSTRAINT "recon_matches_pending_payment_id_payments_id_fk" FOREIGN KEY ("pending_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_matches" ADD CONSTRAINT "recon_matches_matched_by_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_matches" ADD CONSTRAINT "recon_matches_unmatched_by_users_id_fk" FOREIGN KEY ("unmatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_history" ADD CONSTRAINT "salary_history_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_history" ADD CONSTRAINT "salary_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_line_id_payroll_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_loans" ADD CONSTRAINT "staff_loans_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_loans" ADD CONSTRAINT "staff_loans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pay_items" ADD CONSTRAINT "staff_pay_items_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pay_items" ADD CONSTRAINT "staff_pay_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_session_id_academic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_history" ADD CONSTRAINT "workflow_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_txn_source" ON "account_transactions" USING btree ("source_type","source_id","kind");--> statement-breakpoint
CREATE INDEX "account_txn_account_date" ON "account_transactions" USING btree ("account_id","txn_date");--> statement-breakpoint
CREATE UNIQUE INDEX "arms_class_name" ON "arms" USING btree ("class_id","name");--> statement-breakpoint
CREATE INDEX "attachments_entity" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_record" ON "audit_events" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_student_session_live" ON "enrolments" USING btree ("student_id","session_id") WHERE status <> 'reversed';--> statement-breakpoint
CREATE INDEX "enrolments_session_class" ON "enrolments" USING btree ("session_id","class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_parent" ON "expense_categories" USING btree ("name","parent_id");--> statement-breakpoint
CREATE INDEX "expenses_status" ON "expenses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_charges_fee_student" ON "fee_charges" USING btree ("fee_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_charges_student" ON "fee_charges" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_mappings_kind_name" ON "import_mappings" USING btree ("kind","name");--> statement-breakpoint
CREATE INDEX "login_attempts_email_at" ON "login_attempts" USING btree ("email","at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_payment_charge" ON "payment_allocations" USING btree ("payment_id","charge_id");--> statement-breakpoint
CREATE INDEX "payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_student" ON "payments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "payments_reference" ON "payments" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_period_staff" ON "payroll_lines" USING btree ("period_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_period_live" ON "payroll_periods" USING btree ("period") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "statement_lines_account_date" ON "statement_lines" USING btree ("account_id","line_date");--> statement-breakpoint
CREATE INDEX "students_name" ON "students" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_session_seq" ON "terms" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "workflow_history_entity" ON "workflow_history" USING btree ("entity_type","entity_id");