-- Explicit owner wallet grants are independent of legacy approval-only requests.
-- This migration does not enable any operation or provision a wallet signer.
ALTER TABLE control_activity_events DROP CONSTRAINT control_event_type,
  ADD CONSTRAINT control_event_type CHECK (event_type IN (
    'CLIENT_CREATED','CLIENT_REVOKED','CREDENTIAL_CREATED','CREDENTIAL_ROTATED','CREDENTIAL_REVOKED',
    'POLICY_UPDATED','INVESTMENT_REQUESTED','APPROVAL_APPROVED','APPROVAL_REJECTED','APPROVAL_EXPIRED',
    'OAUTH_CONNECTED','OAUTH_DISCONNECTED','OAUTH_TOKEN_REVOKED') OR
    event_type ~ '^AGENT_(BUY|SELL|TRANSFER_SOL|TRANSFER_USDC)_(RESERVED|SIGNING|SIGNED|SUBMITTED|UNKNOWN|CONFIRMED|FAILED|REJECTED)$');

CREATE TABLE control_wallet_operation_locks (wallet_address text PRIMARY KEY);
-- UPDATE permission is required by SELECT FOR UPDATE, not permission to rename a lock.
CREATE TRIGGER control_wallet_operation_locks_immutable BEFORE UPDATE OR DELETE ON control_wallet_operation_locks
  FOR EACH ROW EXECUTE FUNCTION reject_control_activity_mutation();

CREATE TABLE control_agent_wallet_policies (
  client_id uuid PRIMARY KEY,
  account_id text NOT NULL,
  wallet_address text NOT NULL,
  policy jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  eligibility_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (client_id, account_id) REFERENCES control_clients(id, account_id),
  FOREIGN KEY (account_id, wallet_address) REFERENCES control_accounts(id, primary_wallet_address),
  CHECK (jsonb_typeof(policy) = 'object')
);

CREATE TABLE control_agent_operations (
  id uuid PRIMARY KEY,
  account_id text NOT NULL,
  client_id uuid NOT NULL,
  wallet_address text NOT NULL,
  client_request_id text NOT NULL CHECK (client_request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  kind text NOT NULL CHECK (kind IN ('BUY', 'SELL', 'TRANSFER_SOL', 'TRANSFER_USDC')),
  amount_raw numeric(20,0) NOT NULL CHECK (amount_raw > 0 AND amount_raw <= 18446744073709551615),
  asset_id text,
  recipient text,
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[A-Za-z0-9_-]{43}$'),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED','REJECTED')),
  provider_request_id text CHECK (length(provider_request_id) BETWEEN 1 AND 256),
  message_fingerprint text CHECK (message_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  transaction_signature text UNIQUE CHECK (transaction_signature ~ '^[1-9A-HJ-NP-Za-km-z]{80,88}$'),
  prepared_context jsonb,
  actual_input_amount_raw numeric(20,0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  resolved_at timestamptz,
  expires_at timestamptz,
  FOREIGN KEY (client_id, account_id) REFERENCES control_clients(id, account_id),
  FOREIGN KEY (account_id, wallet_address) REFERENCES control_accounts(id, primary_wallet_address),
  UNIQUE (account_id, client_id, client_request_id),
  UNIQUE (account_id, provider_request_id),
  CHECK (((kind IN ('BUY','SELL') AND recipient IS NULL AND asset_id IN (
    'prestocks:Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP',
    'xstocks:XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp')) OR
    (kind IN ('TRANSFER_SOL','TRANSFER_USDC') AND asset_id IS NULL AND recipient ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')) IS TRUE),
  CHECK ((provider_request_id IS NULL AND message_fingerprint IS NULL AND prepared_context IS NULL AND expires_at IS NULL) OR
    (provider_request_id IS NOT NULL AND message_fingerprint IS NOT NULL AND jsonb_typeof(prepared_context) = 'object' AND expires_at IS NOT NULL)),
  CHECK ((status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN') AND resolved_at IS NULL AND actual_input_amount_raw IS NULL) OR
    (status IN ('FAILED','REJECTED') AND resolved_at IS NOT NULL AND actual_input_amount_raw IS NULL) OR
    (status = 'CONFIRMED' AND resolved_at IS NOT NULL AND transaction_signature IS NOT NULL AND submitted_at IS NOT NULL
      AND actual_input_amount_raw > 0 AND actual_input_amount_raw <= amount_raw)),
  CHECK (status NOT IN ('SIGNED','SUBMITTED','CONFIRMED') OR transaction_signature IS NOT NULL),
  CHECK (status <> 'SUBMITTED' OR submitted_at IS NOT NULL),
  CHECK (status <> 'REJECTED' OR submitted_at IS NULL OR transaction_signature IS NOT NULL)
);
CREATE UNIQUE INDEX control_agent_operations_unresolved_owner_idx ON control_agent_operations(account_id)
  WHERE status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN');
CREATE UNIQUE INDEX control_agent_operations_unresolved_wallet_idx ON control_agent_operations(wallet_address)
  WHERE status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN');
CREATE UNIQUE INDEX control_manual_executions_unresolved_wallet_idx ON control_manual_investment_executions(wallet_address)
  WHERE status IN ('CLAIMED','SUBMITTED','UNKNOWN');
CREATE INDEX control_agent_operations_budget_idx ON control_agent_operations(client_id, kind, resolved_at, created_at);
CREATE INDEX control_agent_operations_owner_idx ON control_agent_operations(account_id, client_id, created_at DESC, id);

CREATE TABLE control_agent_operation_events (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES control_agent_operations(id),
  status text NOT NULL CHECK (status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER control_agent_operation_events_append_only BEFORE UPDATE OR DELETE ON control_agent_operation_events
  FOR EACH ROW EXECUTE FUNCTION reject_control_activity_mutation();

CREATE FUNCTION protect_control_agent_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Agent operation intent cannot be deleted'; END IF;
  IF (NEW.id,NEW.account_id,NEW.client_id,NEW.wallet_address,NEW.client_request_id,NEW.kind,NEW.amount_raw,
      NEW.asset_id,NEW.recipient,NEW.intent_hash,NEW.policy_version,NEW.created_at) IS DISTINCT FROM
     (OLD.id,OLD.account_id,OLD.client_id,OLD.wallet_address,OLD.client_request_id,OLD.kind,OLD.amount_raw,
      OLD.asset_id,OLD.recipient,OLD.intent_hash,OLD.policy_version,OLD.created_at) THEN
    RAISE EXCEPTION 'Agent operation intent is immutable';
  END IF;
  IF OLD.status IN ('CONFIRMED','FAILED','REJECTED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Resolved agent operation is immutable';
  END IF;
  IF OLD.provider_request_id IS NOT NULL AND
     (NEW.provider_request_id,NEW.message_fingerprint,NEW.prepared_context,NEW.expires_at) IS DISTINCT FROM
     (OLD.provider_request_id,OLD.message_fingerprint,OLD.prepared_context,OLD.expires_at) THEN
    RAISE EXCEPTION 'Agent prepared transaction is immutable';
  END IF;
  IF OLD.provider_request_id IS NULL AND NEW.provider_request_id IS NOT NULL AND
     NOT (OLD.status = 'RESERVED' AND NEW.status = 'SIGNING') THEN
    RAISE EXCEPTION 'Prepared transaction requires signing claim';
  END IF;
  IF OLD.transaction_signature IS NOT NULL AND NEW.transaction_signature IS DISTINCT FROM OLD.transaction_signature THEN
    RAISE EXCEPTION 'Agent signature is immutable';
  END IF;
  IF OLD.transaction_signature IS NULL AND NEW.transaction_signature IS NOT NULL AND
     NOT (OLD.status = 'SIGNING' AND NEW.status = 'SIGNED') THEN
    RAISE EXCEPTION 'Signature requires signing claim';
  END IF;
  IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Submission time is immutable';
  END IF;
  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'RESERVED' AND NEW.status IN ('SIGNING','REJECTED')) OR
    (OLD.status = 'SIGNING' AND NEW.status IN ('SIGNED','UNKNOWN')) OR
    (OLD.status = 'SIGNED' AND NEW.status IN ('SUBMITTED','UNKNOWN','REJECTED')) OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('UNKNOWN','CONFIRMED','FAILED','REJECTED')) OR
    (OLD.status = 'UNKNOWN' AND NEW.status IN ('CONFIRMED','FAILED'))
  ) THEN RAISE EXCEPTION 'Invalid agent operation transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER control_agent_operation_protected BEFORE UPDATE OR DELETE ON control_agent_operations
  FOR EACH ROW EXECUTE FUNCTION protect_control_agent_operation();

-- Both directions lock the same owner row. Cross-table checks without this lock
-- allow concurrent manual and agent requests to each observe an empty ledger.
CREATE FUNCTION guard_control_agent_operation_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM control_accounts WHERE id = NEW.account_id AND primary_wallet_address = NEW.wallet_address FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent wallet binding mismatch'; END IF;
  INSERT INTO control_wallet_operation_locks(wallet_address) VALUES (NEW.wallet_address) ON CONFLICT DO NOTHING;
  PERFORM wallet_address FROM control_wallet_operation_locks WHERE wallet_address = NEW.wallet_address FOR UPDATE;
  IF EXISTS (SELECT 1 FROM control_manual_investment_executions WHERE (account_id = NEW.account_id OR wallet_address = NEW.wallet_address)
    AND status IN ('CLAIMED','SUBMITTED','UNKNOWN')) THEN
    RAISE EXCEPTION 'Unresolved manual operation' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER control_agent_operation_insert_guard BEFORE INSERT ON control_agent_operations
  FOR EACH ROW EXECUTE FUNCTION guard_control_agent_operation_insert();

CREATE FUNCTION guard_control_manual_agent_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM control_accounts WHERE id = NEW.account_id AND primary_wallet_address = NEW.wallet_address FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manual wallet binding mismatch'; END IF;
  INSERT INTO control_wallet_operation_locks(wallet_address) VALUES (NEW.wallet_address) ON CONFLICT DO NOTHING;
  PERFORM wallet_address FROM control_wallet_operation_locks WHERE wallet_address = NEW.wallet_address FOR UPDATE;
  IF EXISTS (SELECT 1 FROM control_agent_operations WHERE (account_id = NEW.account_id OR wallet_address = NEW.wallet_address)
    AND status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN')) THEN
    RAISE EXCEPTION 'Unresolved agent operation' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER control_manual_agent_operation_guard BEFORE INSERT ON control_manual_investment_executions
  FOR EACH ROW EXECUTE FUNCTION guard_control_manual_agent_operation();
