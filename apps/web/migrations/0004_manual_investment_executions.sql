-- Manual owner BUY/SELL submission ledger. This does not grant signing authority or
-- enable execution. A claim is committed before any external submit, so an
-- ambiguous provider result cannot authorize a second submit of the same order.
-- Store only the signed transaction's signature and message commitment, never
-- raw transaction bytes or wallet secrets.
CREATE TABLE control_manual_investment_executions (
  id uuid PRIMARY KEY,
  account_id text NOT NULL,
  wallet_address text NOT NULL,
  provider_request_id text NOT NULL,
  message_fingerprint text NOT NULL,
  transaction_signature text NOT NULL,
  side text NOT NULL,
  input_mint text NOT NULL,
  output_mint text NOT NULL,
  input_decimals integer NOT NULL,
  output_decimals integer NOT NULL,
  input_amount_raw numeric(20,0) NOT NULL,
  required_minimum_output_raw numeric(20,0) NOT NULL,
  maximum_wallet_native_debit_lamports_raw numeric(20,0) NOT NULL,
  status text NOT NULL DEFAULT 'CLAIMED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  resolved_at timestamptz,
  actual_input_amount_raw numeric(20,0),
  actual_output_amount_raw numeric(20,0),
  actual_wallet_native_debit_lamports_raw numeric(20,0),
  CONSTRAINT control_manual_execution_owner FOREIGN KEY (account_id, wallet_address)
    REFERENCES control_accounts(id, primary_wallet_address),
  CONSTRAINT control_manual_execution_request_length CHECK (length(provider_request_id) BETWEEN 1 AND 256),
  CONSTRAINT control_manual_execution_fingerprint CHECK (message_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT control_manual_execution_signature CHECK (transaction_signature ~ '^[1-9A-HJ-NP-Za-km-z]{80,88}$'),
  CONSTRAINT control_manual_execution_side CHECK (side IN ('BUY', 'SELL')),
  CONSTRAINT control_manual_execution_mints CHECK (
    input_mint <> output_mint AND length(input_mint) BETWEEN 32 AND 44
    AND length(output_mint) BETWEEN 32 AND 44
    AND ((side = 'BUY' AND input_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      AND input_decimals = 6)
      OR (side = 'SELL' AND output_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      AND output_decimals = 6))
  ),
  CONSTRAINT control_manual_execution_input_decimals CHECK (input_decimals BETWEEN 0 AND 255),
  CONSTRAINT control_manual_execution_output_decimals CHECK (output_decimals BETWEEN 0 AND 255),
  CONSTRAINT control_manual_execution_amount CHECK (input_amount_raw > 0 AND input_amount_raw <= 18446744073709551615),
  CONSTRAINT control_manual_execution_minimum_output CHECK (
    required_minimum_output_raw > 0 AND required_minimum_output_raw <= 18446744073709551615
  ),
  CONSTRAINT control_manual_execution_native_cap CHECK (
    maximum_wallet_native_debit_lamports_raw > 0
    AND maximum_wallet_native_debit_lamports_raw <= 18446744073709551615
  ),
  CONSTRAINT control_manual_execution_status CHECK (status IN ('CLAIMED', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED', 'FAILED', 'REJECTED')),
  CONSTRAINT control_manual_execution_expiry CHECK (expires_at > created_at),
  CONSTRAINT control_manual_execution_result CHECK (
    (status = 'CONFIRMED' AND submitted_at IS NOT NULL AND resolved_at IS NOT NULL
      AND actual_input_amount_raw IS NOT NULL AND actual_output_amount_raw IS NOT NULL
      AND actual_wallet_native_debit_lamports_raw IS NOT NULL
      AND actual_input_amount_raw > 0 AND actual_input_amount_raw <= input_amount_raw
      AND actual_output_amount_raw >= required_minimum_output_raw
      AND actual_output_amount_raw <= 18446744073709551615
      AND actual_wallet_native_debit_lamports_raw > 0
      AND actual_wallet_native_debit_lamports_raw <= maximum_wallet_native_debit_lamports_raw)
    OR (status = 'FAILED' AND resolved_at IS NOT NULL
      AND actual_input_amount_raw IS NULL AND actual_output_amount_raw IS NULL
      AND actual_wallet_native_debit_lamports_raw IS NULL)
    OR (status = 'REJECTED' AND submitted_at IS NULL AND resolved_at IS NOT NULL
      AND actual_input_amount_raw IS NULL AND actual_output_amount_raw IS NULL
      AND actual_wallet_native_debit_lamports_raw IS NULL)
    OR (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND resolved_at IS NULL
      AND actual_input_amount_raw IS NULL AND actual_output_amount_raw IS NULL
      AND actual_wallet_native_debit_lamports_raw IS NULL)
    OR (status = 'CLAIMED' AND submitted_at IS NULL AND resolved_at IS NULL
      AND actual_input_amount_raw IS NULL AND actual_output_amount_raw IS NULL
      AND actual_wallet_native_debit_lamports_raw IS NULL)
    OR (status = 'UNKNOWN' AND resolved_at IS NULL
      AND actual_input_amount_raw IS NULL AND actual_output_amount_raw IS NULL
      AND actual_wallet_native_debit_lamports_raw IS NULL)
  ),
  UNIQUE (account_id, provider_request_id),
  UNIQUE (transaction_signature)
);
CREATE INDEX control_manual_executions_unresolved_idx
  ON control_manual_investment_executions(created_at, id)
  WHERE status IN ('CLAIMED', 'SUBMITTED', 'UNKNOWN');
-- A second quote may be prepared concurrently, but only one unresolved
-- transaction for an owner can ever cross the provider boundary.
CREATE UNIQUE INDEX control_manual_executions_one_unresolved_owner_idx
  ON control_manual_investment_executions(account_id)
  WHERE status IN ('CLAIMED', 'SUBMITTED', 'UNKNOWN');
CREATE INDEX control_manual_executions_owner_created_idx
  ON control_manual_investment_executions(account_id, created_at DESC, id);

CREATE FUNCTION protect_control_manual_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Manual execution ledger cannot be deleted';
  END IF;
  IF (NEW.id, NEW.account_id, NEW.wallet_address, NEW.provider_request_id,
      NEW.message_fingerprint, NEW.transaction_signature, NEW.side, NEW.input_mint,
      NEW.output_mint, NEW.input_decimals, NEW.output_decimals, NEW.input_amount_raw, NEW.required_minimum_output_raw,
      NEW.maximum_wallet_native_debit_lamports_raw,
      NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.account_id, OLD.wallet_address, OLD.provider_request_id,
      OLD.message_fingerprint, OLD.transaction_signature, OLD.side, OLD.input_mint,
      OLD.output_mint, OLD.input_decimals, OLD.output_decimals, OLD.input_amount_raw, OLD.required_minimum_output_raw,
      OLD.maximum_wallet_native_debit_lamports_raw,
      OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'Manual execution intent is immutable';
  END IF;
  IF OLD.status IN ('CONFIRMED', 'FAILED', 'REJECTED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Resolved manual execution is immutable';
  END IF;
  IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Manual execution submission time is immutable';
  END IF;
  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'CLAIMED' AND NEW.status IN ('SUBMITTED', 'UNKNOWN', 'CONFIRMED', 'FAILED', 'REJECTED')) OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('UNKNOWN', 'CONFIRMED', 'FAILED')) OR
    (OLD.status = 'UNKNOWN' AND NEW.status IN ('SUBMITTED', 'CONFIRMED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'Invalid manual execution transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER control_manual_execution_protected
  BEFORE UPDATE OR DELETE ON control_manual_investment_executions
  FOR EACH ROW EXECUTE FUNCTION protect_control_manual_execution();

CREATE TABLE control_manual_execution_events (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES control_manual_investment_executions(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_manual_event_status CHECK (status IN ('CLAIMED', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED', 'FAILED', 'REJECTED'))
);
CREATE INDEX control_manual_events_execution_idx ON control_manual_execution_events(execution_id, created_at, id);
CREATE TRIGGER control_manual_events_append_only
  BEFORE UPDATE OR DELETE ON control_manual_execution_events
  FOR EACH ROW EXECUTE FUNCTION reject_control_activity_mutation();
