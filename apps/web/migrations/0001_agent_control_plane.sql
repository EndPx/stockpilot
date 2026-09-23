-- Additive control-plane schema. No wallet key, transaction signer, or execution ledger.
CREATE TABLE control_accounts (
  id text PRIMARY KEY,
  primary_wallet_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_accounts_identity CHECK (length(id) BETWEEN 3 AND 128),
  CONSTRAINT control_accounts_wallet CHECK (length(primary_wallet_address) BETWEEN 32 AND 44)
);

CREATE TABLE control_clients (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES control_accounts(id),
  name text NOT NULL,
  client_type text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (id, account_id),
  CONSTRAINT control_clients_name CHECK (length(name) BETWEEN 1 AND 80),
  CONSTRAINT control_clients_type CHECK (client_type IN ('CLAUDE_CODE', 'CODEX', 'CURSOR', 'CUSTOM')),
  CONSTRAINT control_clients_status CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED'))
);
CREATE INDEX control_clients_account_created_idx ON control_clients(account_id, created_at DESC, id);

CREATE TABLE control_credentials (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES control_clients(id),
  display_prefix text NOT NULL,
  secret_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT control_credentials_hash_length CHECK (octet_length(secret_hash) = 32),
  CONSTRAINT control_credentials_prefix_length CHECK (length(display_prefix) BETWEEN 12 AND 40)
);
CREATE UNIQUE INDEX control_credentials_one_active_idx ON control_credentials(client_id) WHERE revoked_at IS NULL;

CREATE TABLE control_grant_policies (
  client_id uuid PRIMARY KEY REFERENCES control_clients(id),
  approval_mode text NOT NULL DEFAULT 'ALWAYS_APPROVE',
  scopes text[] NOT NULL,
  max_investment_usd numeric(20,6) NOT NULL,
  daily_request_limit_usd numeric(20,6) NOT NULL,
  allowed_providers text[] NOT NULL,
  allowed_market_types text[] NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_policy_mode CHECK (approval_mode = 'ALWAYS_APPROVE'),
  CONSTRAINT control_policy_scopes CHECK (scopes <@ ARRAY['markets:read', 'portfolio:read', 'investments:request', 'requests:read-own', 'approvals:read-own']::text[]),
  CONSTRAINT control_policy_providers CHECK (allowed_providers <@ ARRAY['prestocks']::text[]),
  CONSTRAINT control_policy_market_types CHECK (allowed_market_types <@ ARRAY['PRE_IPO']::text[]),
  CONSTRAINT control_policy_limits CHECK (max_investment_usd > 0 AND daily_request_limit_usd > 0),
  CONSTRAINT control_policy_version CHECK (version > 0)
);

CREATE TABLE control_investment_requests (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES control_accounts(id),
  client_id uuid NOT NULL REFERENCES control_clients(id),
  asset_id text NOT NULL,
  asset_name text NOT NULL,
  asset_symbol text NOT NULL,
  provider text NOT NULL,
  market_type text NOT NULL,
  canonical_mint text NOT NULL,
  funding_mint text NOT NULL,
  amount_usd numeric(20,6) NOT NULL,
  policy_version integer NOT NULL,
  policy_max_investment_usd numeric(20,6) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  CONSTRAINT control_request_amount CHECK (amount_usd > 0),
  CONSTRAINT control_request_provider CHECK (provider = 'prestocks' AND market_type = 'PRE_IPO'),
  CONSTRAINT control_request_status CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'BLOCKED')),
  CONSTRAINT control_request_expiry CHECK (expires_at > created_at),
  CONSTRAINT control_request_client_account FOREIGN KEY (client_id, account_id)
    REFERENCES control_clients(id, account_id),
  UNIQUE (id, account_id)
);
CREATE INDEX control_requests_account_created_idx ON control_investment_requests(account_id, created_at DESC, id);
CREATE INDEX control_requests_client_created_idx ON control_investment_requests(client_id, created_at DESC, id);
CREATE INDEX control_requests_pending_expiry_idx ON control_investment_requests(expires_at) WHERE status = 'PENDING_APPROVAL';

CREATE TABLE control_approvals (
  request_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES control_accounts(id),
  decision text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_approvals_decision CHECK (decision IN ('APPROVED', 'REJECTED')),
  CONSTRAINT control_approvals_request_account FOREIGN KEY (request_id, account_id)
    REFERENCES control_investment_requests(id, account_id)
);

CREATE TABLE control_activity_events (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES control_accounts(id),
  client_id uuid,
  request_id uuid,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_event_type CHECK (event_type IN ('CLIENT_CREATED', 'CLIENT_REVOKED', 'CREDENTIAL_CREATED', 'CREDENTIAL_ROTATED', 'CREDENTIAL_REVOKED', 'POLICY_UPDATED', 'INVESTMENT_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'APPROVAL_EXPIRED')),
  CONSTRAINT control_event_actor CHECK (actor_type IN ('USER', 'CLIENT', 'SYSTEM')),
  CONSTRAINT control_event_details CHECK (jsonb_typeof(details) = 'object'),
  CONSTRAINT control_event_client_account FOREIGN KEY (client_id, account_id)
    REFERENCES control_clients(id, account_id),
  CONSTRAINT control_event_request_account FOREIGN KEY (request_id, account_id)
    REFERENCES control_investment_requests(id, account_id)
);
CREATE INDEX control_activity_account_created_idx ON control_activity_events(account_id, created_at DESC, id);

CREATE FUNCTION reject_control_activity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Control-plane activity is append-only';
END;
$$;
CREATE TRIGGER control_activity_no_update BEFORE UPDATE OR DELETE ON control_activity_events
  FOR EACH ROW EXECUTE FUNCTION reject_control_activity_mutation();

CREATE FUNCTION protect_control_request_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.account_id, NEW.client_id, NEW.asset_id, NEW.asset_name,
      NEW.asset_symbol, NEW.provider, NEW.market_type, NEW.canonical_mint,
      NEW.funding_mint, NEW.amount_usd, NEW.policy_version,
      NEW.policy_max_investment_usd, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.account_id, OLD.client_id, OLD.asset_id, OLD.asset_name,
      OLD.asset_symbol, OLD.provider, OLD.market_type, OLD.canonical_mint,
      OLD.funding_mint, OLD.amount_usd, OLD.policy_version,
      OLD.policy_max_investment_usd, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'Investment request intent is immutable';
  END IF;
  IF OLD.status <> 'PENDING_APPROVAL' AND
     (NEW.status IS DISTINCT FROM OLD.status OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
    RAISE EXCEPTION 'Final investment request status is immutable';
  END IF;
  IF OLD.status = 'PENDING_APPROVAL' AND NEW.status <> 'PENDING_APPROVAL' AND NEW.decided_at IS NULL THEN
    RAISE EXCEPTION 'Final investment request requires a decision time';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER control_request_intent_immutable BEFORE UPDATE ON control_investment_requests
  FOR EACH ROW EXECUTE FUNCTION protect_control_request_intent();
