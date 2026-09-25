-- Apply as the Neon migration owner after migration 0004. The runtime role
-- may claim and reconcile its append-only trade ledger, but cannot delete it
-- or alter the schema. PostgreSQL triggers enforce immutable intent fields.
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.control_manual_investment_executions
TO stockpilot_app;
GRANT SELECT, INSERT ON TABLE
  public.control_manual_execution_events
TO stockpilot_app;
