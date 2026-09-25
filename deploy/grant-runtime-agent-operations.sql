-- Apply as the existing Neon migration owner after migration 0005.
-- No ownership, schema creation, delete or event mutation is granted.
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.control_agent_wallet_policies,
  public.control_agent_operations,
  public.control_wallet_operation_locks
TO stockpilot_app;
GRANT SELECT, INSERT ON TABLE public.control_agent_operation_events TO stockpilot_app;
