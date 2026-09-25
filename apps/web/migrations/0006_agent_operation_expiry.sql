-- Expiry is distinct from a finalized on-chain failure. No existing operation
-- is resolved by this migration; the application must supply audited evidence.
ALTER TABLE control_agent_operations
  ADD COLUMN expiry_evidence jsonb,
  DROP CONSTRAINT control_agent_operations_status_check,
  ADD CONSTRAINT control_agent_operations_status_check CHECK
    (status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED','REJECTED','EXPIRED')),
  DROP CONSTRAINT control_agent_operations_check2,
  ADD CONSTRAINT control_agent_operation_accounting CHECK (
    (status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN') AND resolved_at IS NULL AND actual_input_amount_raw IS NULL) OR
    (status IN ('FAILED','REJECTED','EXPIRED') AND resolved_at IS NOT NULL AND actual_input_amount_raw IS NULL) OR
    (status = 'CONFIRMED' AND resolved_at IS NOT NULL AND transaction_signature IS NOT NULL AND submitted_at IS NOT NULL
      AND actual_input_amount_raw > 0 AND actual_input_amount_raw <= amount_raw)),
  ADD CONSTRAINT control_agent_operation_expiry_evidence CHECK (
    ((status <> 'EXPIRED' AND expiry_evidence IS NULL) OR
     (status = 'EXPIRED' AND transaction_signature IS NOT NULL AND submitted_at IS NOT NULL AND prepared_context IS NOT NULL AND
      jsonb_typeof(expiry_evidence) = 'object' AND
      expiry_evidence->>'operationId' = id::text AND expiry_evidence->>'signature' = transaction_signature AND
      expiry_evidence->>'messageFingerprint' = message_fingerprint AND
      expiry_evidence->>'lastValidBlockHeight' = prepared_context->>'lastValidBlockHeight' AND
      jsonb_typeof(expiry_evidence->'witnesses') = 'array' AND jsonb_array_length(expiry_evidence->'witnesses') = 2)) IS TRUE);

ALTER TABLE control_agent_operation_events DROP CONSTRAINT control_agent_operation_events_status_check,
  ADD CONSTRAINT control_agent_operation_events_status_check CHECK
    (status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED','REJECTED','EXPIRED'));

ALTER TABLE control_activity_events DROP CONSTRAINT control_event_type,
  ADD CONSTRAINT control_event_type CHECK (event_type IN (
    'CLIENT_CREATED','CLIENT_REVOKED','CREDENTIAL_CREATED','CREDENTIAL_ROTATED','CREDENTIAL_REVOKED',
    'POLICY_UPDATED','INVESTMENT_REQUESTED','APPROVAL_APPROVED','APPROVAL_REJECTED','APPROVAL_EXPIRED',
    'OAUTH_CONNECTED','OAUTH_DISCONNECTED','OAUTH_TOKEN_REVOKED') OR
    event_type ~ '^AGENT_(BUY|SELL|TRANSFER_SOL|TRANSFER_USDC)_(RESERVED|SIGNING|SIGNED|SUBMITTED|UNKNOWN|CONFIRMED|FAILED|REJECTED|EXPIRED)$');

CREATE OR REPLACE FUNCTION protect_control_agent_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Agent operation intent cannot be deleted'; END IF;
  IF (NEW.id,NEW.account_id,NEW.client_id,NEW.wallet_address,NEW.client_request_id,NEW.kind,NEW.amount_raw,
      NEW.asset_id,NEW.recipient,NEW.intent_hash,NEW.policy_version,NEW.created_at) IS DISTINCT FROM
     (OLD.id,OLD.account_id,OLD.client_id,OLD.wallet_address,OLD.client_request_id,OLD.kind,OLD.amount_raw,
      OLD.asset_id,OLD.recipient,OLD.intent_hash,OLD.policy_version,OLD.created_at) THEN
    RAISE EXCEPTION 'Agent operation intent is immutable';
  END IF;
  IF OLD.status IN ('CONFIRMED','FAILED','REJECTED','EXPIRED') AND NEW IS DISTINCT FROM OLD THEN
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
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('UNKNOWN','CONFIRMED','FAILED','REJECTED','EXPIRED')) OR
    (OLD.status = 'UNKNOWN' AND NEW.status IN ('CONFIRMED','FAILED','EXPIRED'))
  ) THEN RAISE EXCEPTION 'Invalid agent operation transition'; END IF;
  RETURN NEW;
END;
$$;
