-- Run as the Neon migration owner after the schema migrations when the app uses
-- the separate stockpilot_app role. Migration 0002 created these tables after
-- the role's original table grants; changing that applied migration is unsafe.
-- This script is idempotent and deliberately grants no DELETE or DDL authority.
GRANT USAGE ON SCHEMA public TO stockpilot_app;
-- PostgreSQL requires UPDATE on at least one column for SELECT ... FOR UPDATE.
-- Only the harmless timestamp is writable; the verified wallet stays immutable.
GRANT UPDATE (updated_at) ON TABLE public.control_accounts TO stockpilot_app;
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.control_oauth_subject_bindings,
  public.control_oauth_connections
TO stockpilot_app;
