CREATE TABLE plans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('account', 'user')),
    is_predefined BOOLEAN NOT NULL DEFAULT FALSE,
    owner_account_id BIGINT,
    monthly_allowance BIGINT NOT NULL CHECK (monthly_allowance >= 0),
    max_units_per_request BIGINT NOT NULL CHECK (max_units_per_request > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT plans_owner_check CHECK (
        (is_predefined = TRUE AND owner_account_id IS NULL)
        OR
        (is_predefined = FALSE AND owner_account_id IS NOT NULL)
    ),

    CONSTRAINT plans_name_scope_owner_unique
        UNIQUE NULLS NOT DISTINCT (name, scope, owner_account_id)
);

CREATE TABLE accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_account_external_id_unique
        UNIQUE (account_id, external_id),

    CONSTRAINT users_id_account_unique
        UNIQUE (id, account_id)
);

ALTER TABLE plans
    ADD CONSTRAINT plans_owner_account_fk
    FOREIGN KEY (owner_account_id) REFERENCES accounts(id)
    ON DELETE CASCADE;

CREATE TABLE consumption_requests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id),
    user_id BIGINT NOT NULL,
    request_id TEXT NOT NULL,
    units BIGINT NOT NULL CHECK (units > 0),
    status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
    rejection_reason TEXT CHECK (
        rejection_reason IS NULL
        OR rejection_reason IN (
            'account_monthly_allowance',
            'account_max_units_per_request',
            'user_monthly_allowance',
            'user_max_units_per_request'
        )
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT consumption_user_account_fk
        FOREIGN KEY (user_id, account_id)
        REFERENCES users(id, account_id),

    CONSTRAINT consumption_request_id_unique
        UNIQUE (account_id, request_id),

    CONSTRAINT consumption_status_reason_check CHECK (
        (status = 'accepted' AND rejection_reason IS NULL)
        OR
        (status = 'rejected' AND rejection_reason IS NOT NULL)
    )
);

CREATE INDEX consumption_account_month_idx
    ON consumption_requests (account_id, created_at)
    WHERE status = 'accepted';

CREATE INDEX consumption_user_month_idx
    ON consumption_requests (user_id, created_at)
    WHERE status = 'accepted';

CREATE INDEX consumption_history_idx
    ON consumption_requests (account_id, created_at DESC, id DESC);

INSERT INTO plans (
    name,
    scope,
    is_predefined,
    owner_account_id,
    monthly_allowance,
    max_units_per_request
)
VALUES
    ('Starter', 'account', TRUE, NULL, 10000, 1000),
    ('Pro', 'account', TRUE, NULL, 100000, 10000),
    ('Basic', 'user', TRUE, NULL, 1000, 100),
    ('Premium', 'user', TRUE, NULL, 10000, 1000);
