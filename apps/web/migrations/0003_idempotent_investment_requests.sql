-- A client-generated request ID lets an MCP caller safely repeat the same
-- submission after a timeout without creating another approval request.
ALTER TABLE control_investment_requests
  ADD COLUMN client_request_id text,
  ADD CONSTRAINT control_request_client_request_id CHECK (
    client_request_id IS NULL OR
    (length(client_request_id) BETWEEN 16 AND 128 AND client_request_id ~ '^[A-Za-z0-9_-]+$')
  );

CREATE UNIQUE INDEX control_requests_client_request_id_unique
  ON control_investment_requests(client_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE FUNCTION protect_control_request_idempotency_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_request_id IS DISTINCT FROM OLD.client_request_id THEN
    RAISE EXCEPTION 'Investment request idempotency key is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER control_request_idempotency_key_immutable
  BEFORE UPDATE ON control_investment_requests
  FOR EACH ROW EXECUTE FUNCTION protect_control_request_idempotency_key();
