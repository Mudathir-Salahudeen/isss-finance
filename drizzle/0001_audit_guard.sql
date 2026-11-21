-- Audit log is append-only: block UPDATE, DELETE and TRUNCATE at the database level.
CREATE OR REPLACE FUNCTION audit_events_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_change();
--> statement-breakpoint
-- Account ledger rows are insert-only too: corrections are new reversing rows.
CREATE OR REPLACE FUNCTION ledger_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'account_transactions is insert-only (% blocked); post a reversing entry instead', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER account_transactions_no_change BEFORE UPDATE OR DELETE ON account_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_block_change();
--> statement-breakpoint
-- An approved payment's money fields can never be edited in place.
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('approved','reversed') AND (
      NEW.amount <> OLD.amount OR NEW.student_id <> OLD.student_id OR NEW.account_id <> OLD.account_id
      OR NEW.payment_date <> OLD.payment_date) THEN
    RAISE EXCEPTION 'approved payments cannot be edited; use reversal';
  END IF;
  IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
    RAISE EXCEPTION 'reversed payments are final';
  END IF;
  IF OLD.status = 'approved' AND NEW.status NOT IN ('approved','reversed') THEN
    RAISE EXCEPTION 'approved payment can only move to reversed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payments_no_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft payments can be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_no_delete();
