-- Extend the existing control plane without changing already-applied migration 0001.
-- A connected OAuth subject is first bound through a verified owner session and
-- wallet, never inferred from an email address or an access token alone.
ALTER TABLE control_accounts
  ADD CONSTRAINT control_accounts_id_wallet_unique UNIQUE (id, primary_wallet_address);

CREATE TABLE control_oauth_subject_bindings (
  issuer text NOT NULL,
  subject text NOT NULL,
  account_id text NOT NULL,
  wallet_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, account_id),
  UNIQUE (issuer, subject, account_id),
  CONSTRAINT control_oauth_binding_account FOREIGN KEY (account_id, wallet_address)
    REFERENCES control_accounts(id, primary_wallet_address),
  CONSTRAINT control_oauth_binding_issuer_length CHECK (length(issuer) BETWEEN 8 AND 512),
  CONSTRAINT control_oauth_binding_subject_length CHECK (length(subject) BETWEEN 1 AND 512)
);

CREATE TABLE control_oauth_connections (
  client_id uuid PRIMARY KEY,
  account_id text NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  oauth_client_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT control_oauth_connection_client_account FOREIGN KEY (client_id, account_id)
    REFERENCES control_clients(id, account_id),
  CONSTRAINT control_oauth_connection_subject_account FOREIGN KEY (issuer, subject, account_id)
    REFERENCES control_oauth_subject_bindings(issuer, subject, account_id),
  CONSTRAINT control_oauth_issuer_length CHECK (length(issuer) BETWEEN 8 AND 512),
  CONSTRAINT control_oauth_subject_length CHECK (length(subject) BETWEEN 1 AND 512),
  CONSTRAINT control_oauth_client_id_length CHECK (length(oauth_client_id) BETWEEN 1 AND 1024),
  UNIQUE (issuer, subject, oauth_client_id)
);

ALTER TABLE control_grant_policies
  ADD COLUMN buy_mode text NOT NULL DEFAULT 'APPROVAL',
  ADD COLUMN sell_mode text NOT NULL DEFAULT 'DISABLED',
  ADD CONSTRAINT control_policy_buy_mode CHECK (buy_mode IN ('DISABLED', 'APPROVAL', 'AUTO')),
  ADD CONSTRAINT control_policy_sell_mode CHECK (sell_mode IN ('DISABLED', 'APPROVAL', 'AUTO'));

-- NULL is an explicit owner-selected unlimited cap. Existing finite caps remain
-- unchanged. The API, not a token claim, controls whether a cap may be removed.
ALTER TABLE control_grant_policies
  ALTER COLUMN max_investment_usd DROP NOT NULL,
  ALTER COLUMN daily_request_limit_usd DROP NOT NULL,
  DROP CONSTRAINT control_policy_limits,
  ADD CONSTRAINT control_policy_limits CHECK (
    (max_investment_usd IS NULL OR max_investment_usd > 0) AND
    (daily_request_limit_usd IS NULL OR daily_request_limit_usd > 0) AND
    (max_investment_usd IS NULL OR daily_request_limit_usd IS NULL OR daily_request_limit_usd >= max_investment_usd)
  );

-- Preserve the immutable snapshot of the policy applied when a request was made.
ALTER TABLE control_investment_requests
  ALTER COLUMN policy_max_investment_usd DROP NOT NULL;

ALTER TABLE control_activity_events
  DROP CONSTRAINT control_event_type,
  ADD CONSTRAINT control_event_type CHECK (event_type IN (
    'CLIENT_CREATED', 'CLIENT_REVOKED', 'CREDENTIAL_CREATED', 'CREDENTIAL_ROTATED',
    'CREDENTIAL_REVOKED', 'POLICY_UPDATED', 'INVESTMENT_REQUESTED',
    'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'APPROVAL_EXPIRED',
    'OAUTH_CONNECTED', 'OAUTH_DISCONNECTED', 'OAUTH_TOKEN_REVOKED'
  ));
