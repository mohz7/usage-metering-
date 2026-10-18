# Usage Metering and Quota Service

A TypeScript and PostgreSQL service that tracks usage for accounts and their users, enforces monthly quotas, and records accepted and rejected consumption requests.

## Features

- API-key authentication for account-specific operations.
- Account and user management.
- Predefined account plans: Starter and Pro.
- Predefined user plans: Basic and Premium.
- Account-owned custom plans.
- Monthly usage limits and maximum units per request.
- Account-level and user-level quota enforcement.
- Idempotent consumption requests using request IDs.
- Usage summaries and paginated consumption history.
- Plan changes without deleting historical usage.
- PostgreSQL persistence and Docker Compose support.
- Automated tests and a reproducible load-test script.

## Quick Start

```bash
docker compose up --build
```

This builds and starts the whole stack: PostgreSQL (schema and predefined plans are created on first start), the API at `http://localhost:3000`, and the example client, which runs a short demo against the API and then exits. Look for `Demo completed.` in the output, then press `Ctrl+C`. To stop and also delete the stored data, run `docker compose down -v`.

## Technology Stack

- Node.js 22
- TypeScript
- Express
- PostgreSQL 17
- `pg` connection pool
- Vitest
- Docker and Docker Compose

## Architecture

The API uses Express route modules for accounts, users, plans, and consumption. Business logic is separated into services, while PostgreSQL stores accounts, users, plans, and consumption history.

The consumption service performs quota checks within a database transaction. It locks the account row while processing consumption requests to coordinate shared account quota usage.

## Quota Rules

Every consumption request must satisfy both the account's plan and the user's plan.

The service checks:

1. The requested units must be a positive integer.
2. The request ID must be valid for idempotent processing.
3. The user must belong to the authenticated account.
4. The request must not exceed the account's per-request limit.
5. The request must not exceed the user's per-request limit.
6. The account must have enough monthly allowance.
7. The user must have enough monthly allowance.

A request is accepted only when all applicable limits pass. Rejected requests are recorded in history but do not count toward consumed units.

Monthly usage uses **UTC calendar-month boundaries**. For example, October 2026 usage starts at `2026-10-01T00:00:00.000Z` and ends immediately before `2026-11-01T00:00:00.000Z`. A new request is assigned to the UTC month in which it is processed. Historical usage can be queried by month.

### Rejection Reasons

- `account_max_units_per_request`
- `user_max_units_per_request`
- `account_monthly_allowance`
- `user_monthly_allowance`

### Plan Changes

Account and user plans can be changed without deleting usage history. A plan change affects subsequent consumption decisions.

If a new allowance is lower than the amount already consumed, the remaining allowance is treated as zero, and additional consumption is rejected until the applicable quota permits it.

### Idempotency

Consumption requests include a `requestId`. Repeating a request with the same ID and the same input returns the original result rather than consuming units twice. Reusing the same ID with different input results in an idempotency conflict.

## Default Plans

The database schema seeds these predefined plans:

| Scope | Plan | Monthly allowance | Maximum units per request |
|---|---|---:|---:|
| Account | Starter | 10,000 | 1,000 |
| Account | Pro | 100,000 | 10,000 |
| User | Basic | 1,000 | 100 |
| User | Premium | 10,000 | 1,000 |

These values are the defaults defined in `sql/schema.sql`.

Predefined plans are read-only. Custom plans belong to an account and can be created, updated, assigned, and deleted when they are not in use.

## Requirements

For local development:

- Node.js 22 or a compatible version.
- npm.
- PostgreSQL.
- A configured `.env` file.

For containerized operation:

- Docker Desktop or Docker Engine.
- Docker Compose.

## Configuration

Create a `.env` file in the project root:

```dotenv
PORT=3000
DATABASE_URL=postgres://app_user:app_password@localhost:5433/usage_metering
NODE_ENV=development
```

Use credentials appropriate for your environment. Do not commit `.env` or expose API keys and database credentials.

When running the API through Docker Compose, the API connects to PostgreSQL using the internal service hostname `db` and port `5432`. The local development connection uses the published PostgreSQL port `5433`.

## Local Installation

Install dependencies:

```bash
npm ci
```

Initialize a **new, empty database only** with the schema:

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

**Important:** `sql/schema.sql` creates tables and inserts predefined plans. It is not an idempotent migration. Do not run it against an already initialized database, and do not reset or delete an existing database volume to initialize the project.

Start the development server:

```bash
npm run dev
```

Build and run the production version locally:

```bash
npm run build
npm start
```

## Docker Compose

`docker compose up --build` (see Quick Start) starts everything, including the example client. To start only the API and PostgreSQL services:

```bash
docker compose up --build -d db api
```

This avoids automatically running the demo client, which creates additional database records.

Check service status:

```bash
docker compose ps
```

Check API logs:

```bash
docker compose logs api
```

Check database logs:

```bash
docker compose logs db
```

The API is available at `http://localhost:3000`. PostgreSQL is published on port `5433`.

The Compose configuration uses a named volume to persist PostgreSQL data.

The schema file is mounted into the PostgreSQL initialization directory. PostgreSQL runs initialization scripts only when initializing a fresh data directory. Starting the stack again does not rerun the schema against an existing database.

Do not use `docker compose down -v` on a database whose data must be preserved.

### Health Checks

API liveness:

```bash
curl http://localhost:3000/health
```

API and database readiness:

```bash
curl http://localhost:3000/health/ready
```

## API Overview

Authenticated endpoints use the `X-API-Key` HTTP header. Account creation issues an API key that should be stored securely. The plaintext key is returned when issued and should not be logged or committed.

### Accounts

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/accounts` | Create an account and issue an API key |
| `GET` | `/api/accounts/:id` | Retrieve the authenticated account |
| `PATCH` | `/api/accounts/:id/plan` | Change the account plan |

Account creation accepts an account name and a predefined account plan ID.

### Users

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/users` | Create a user within the authenticated account |
| `GET` | `/api/users/:id` | Retrieve a user belonging to the account |
| `PATCH` | `/api/users/:id/plan` | Change a user's plan |

A user has an external ID and a user plan. User identifiers are scoped to their account.

### Plans

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/plans` | List plans available to the account |
| `POST` | `/api/plans` | Create a custom plan |
| `GET` | `/api/plans/:id` | Retrieve a plan |
| `PUT` | `/api/plans/:id` | Update a custom plan |
| `DELETE` | `/api/plans/:id` | Delete a custom plan when it is not in use |

Custom plan creation accepts a name, scope, monthly allowance, and maximum units per request.

Predefined plans cannot be modified or deleted.

### Consumption

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/consumption` | Submit a consumption request |
| `GET` | `/api/consumption/usage` | Get account and user usage |
| `GET` | `/api/consumption` | Query paginated consumption history |

Example consumption body:

```json
{
  "userId": 1,
  "requestId": "request-unique-001",
  "units": 25
}
```

Use the actual user ID returned by the API.

The usage endpoint accepts an optional `month=YYYY-MM` query parameter. The history endpoint supports month, user ID, status, limit, and offset filters.

Example:

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "http://localhost:3000/api/consumption/usage?month=2026-10"
```

Replace `YOUR_API_KEY` with a valid key. Do not publish the key.

## Example Client

`examples/demo-client.mjs` is a small command-line client that calls the service with an account's API key on behalf of two users. The business action is simulated: the client only asks the service whether to allow N units and prints the decision and the remaining allowances. The client code does not change between scenarios; only the plans do.

It runs automatically with `docker compose up --build` and prints its output in that terminal, ending with `Demo completed.`. To run it again against a running stack:

```bash
docker compose up -d db api
docker compose run --rm demo-client
```

What it demonstrates, in order:

1. Setup: a custom account plan (150 units/month), User A on the predefined Basic plan (1,000/month, 100 per request), and User B on a custom Tight plan (60/month, 20 per request).
2. An accepted request, and a rejection caused by a **user** per-request limit (for both users).
3. A rejection caused by User B's **monthly** allowance.
4. A rejection caused by the shared **account** allowance, even though User A still has 920 units left.
5. Switching User B to the predefined Premium plan: a request that was impossible before is now accepted, until the shared account allowance runs out.
6. Upgrading the account to Pro: the same user and the same client code now succeed. Previously consumed units are preserved across every plan change.

Each run creates a new demo account and plans, so it adds demo data to the database. The client exits with an error if any decision differs from the expected one.

## Automated Tests

```bash
npm test                                                  # unit and route tests (database mocked)
npm run test:coverage                                     # same, with coverage report
API_URL=http://localhost:3000 npm run test:integration    # needs the API and database running
npm run build
```

- **Unit and route tests** (`tests/*.test.ts`) mock the database pool and cover health checks, API-key authentication, account isolation at route and service level, consumption decisions, plan changes and plan routes.
- **Integration tests** (`tests/integration/`) run against a live API and PostgreSQL (for example the Compose stack) and cover real concurrency behavior: exact accepted counts under concurrent requests on a shared account allowance, per-user allowances, concurrent retries of one request ID, lowering and raising an allowance, and isolation between accounts including missing and invalid API keys. They are skipped when `API_URL` is not set, and they create their own accounts, so they add data to the database.

## Performance Testing (single-user baseline)

This first script sends unique 1-unit requests for one user and never reaches a limit. See the section below for the correctness-under-load tests and what they showed.

The load-test script creates its own account and user and sends unique consumption requests.

Ensure the API and database are running, then execute:

```bash
node scripts/load-test.mjs
```

Optional environment variables:

```bash
REQUESTS=100 CONCURRENCY=10 node scripts/load-test.mjs
```

The script supports up to 1,000 requests and concurrency up to 100. It reports successful and failed requests, total duration, throughput, and latency percentiles. Each run creates additional database records.

The script prints its results to standard output. To preserve a new run's report, redirect the output to a file, for example:

```bash
mkdir -p performance
node scripts/load-test.mjs | tee performance/load-test-run.txt
```

This creates a separate text report and does not overwrite the committed baseline JSON file.

The recorded baseline is stored in `performance/load-test-results.json`.

### Recorded Baseline

| Metric | Result |
|---|---:|
| Requests | 100 |
| Concurrency | 10 |
| Successful requests | 100 |
| Failed requests | 0 |
| Total duration | 554.98 ms |
| Throughput | 180.19 requests/second |
| Average latency | 53.31 ms |
| P50 latency | 48.55 ms |
| P95 latency | 84.20 ms |
| Maximum latency | 116.78 ms |

These figures represent one local test run. They are not a production performance guarantee and will vary with hardware, database state, network conditions, and concurrency.

## Data Model

The database includes these main entities:

- **Accounts:** account identity, API-key hash, and assigned account plan.
- **Users:** account membership, external identifier, and assigned user plan.
- **Plans:** scope, allowance, maximum request size, predefined status, and custom-plan ownership.
- **Consumption requests:** account, user, request ID, units, decision, rejection reason, and timestamp.

Database constraints and indexes support account isolation, request idempotency, quota accounting, and history queries.

## Security and Isolation

- API keys are generated as random values and stored as SHA-256 hashes.
- Authenticated operations are scoped to the account associated with the key.
- User/account relationships are checked before consumption.
- Database constraints enforce key relationships and request uniqueness.
- API keys, credentials, and `.env` contents must not be committed.

## Limitations, Assumptions, and Trade-offs

- Monthly usage uses UTC calendar months, with an inclusive start and exclusive end boundary. The month is determined when a request is processed.
- Rejected requests are recorded for audit/history purposes but do not consume quota. Retrying a rejected request with the same ID replays its original decision.
- Custom plans are owned by an account and cannot be changed by another account through authenticated routes. Predefined plans are read-only.
- Requests for the same account are serialized by an account-row lock to enforce the shared allowance under concurrency. A very busy account is therefore limited by single-account throughput; requests for different accounts can proceed in parallel.
- Each decision sums the account's accepted requests for the current month. Query cost grows with monthly usage volume.
- API keys cannot currently be rotated or revoked, and users cannot be deleted through the API.
- Only two quota rules are supported: monthly allowance and maximum units per request.
- The integration tests exercise real PostgreSQL behavior, including concurrency and idempotency. UTC month-boundary behavior is covered by query-boundary unit tests rather than a live-database test with a controllable clock.
- Performance measurements are local benchmarks, not a full stress, soak, or distributed-load test. Results are indicative and depend on machine and database state.
- A possible future optimization is to maintain monthly account and user counters inside the same transaction. This could reduce repeated sums, but would not remove serialization for requests sharing one account.
- Before production deployment, add managed secrets, HTTPS, monitoring, backups, and an appropriate database migration strategy.

## Repository Layout

```text
.
├── examples/
│   └── demo-client.mjs
├── performance/
│   ├── correctness-*.json
│   └── load-test-results.json
├── scripts/
│   ├── load-test.mjs
│   ├── load-test-correctness.mjs
│   └── summarize-results.mjs
├── sql/
│   └── schema.sql
├── src/
│   ├── db/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   └── index.ts
├── tests/
│   └── integration/
│       └── quota.integration.test.ts
├── compose.yaml
├── Dockerfile
├── package.json
└── README.md
```

## Getting an API Key

Creating an account issues its API key. The plaintext key is returned **once**; only its SHA-256 hash is stored, so it cannot be recovered later.

```bash
curl -s -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Docs","planId":"1"}'
```

`planId` is the ID of a predefined account plan (`1` is Starter on a fresh database). Send the returned `apiKey` as `X-API-Key` on every other request. A missing key or malformed key returns `401`, as does a well-formed key that matches no account.

## API Examples

Create a user on the Basic plan, then consume units on their behalf:

```bash
curl -s -X POST http://localhost:3000/api/users \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"externalId":"alice","planId":"3"}'

curl -s -X POST http://localhost:3000/api/consumption \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"userId":"1","requestId":"doc-42","units":25}'
```

Accepted response (`200`):

```json
{ "consumption": { "requestId": "doc-42", "status": "accepted", "rejectionReason": null, "units": "25", "replayed": false } }
```

A rejection is still a `200` with a decision, because it is a normal business outcome:

```json
{ "consumption": { "requestId": "doc-43", "status": "rejected", "rejectionReason": "user_max_units_per_request", "units": "150", "replayed": false } }
```

The reason names the rule and its level (`account_` or `user_`). When several rules would reject a request, the first failing rule in this order is reported: account per-request, user per-request, account monthly, user monthly. `GET /api/consumption/usage` shows each level's plan, allowance, used and remaining units.

Error responses use `{ "error": "<code>" }`: `400` invalid input, `401` bad key, `404` unknown user or account (including another account's user), `409` request ID reused with different input.

### More Examples

Create a custom plan, assign it to a user, then change its limits. The change applies to the next request, with no restart. Use the plan ID returned by the first call:

```bash
curl -s -X POST http://localhost:3000/api/plans \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Interns","scope":"user","monthlyAllowance":"200","maxUnitsPerRequest":"20"}'

curl -s -X PATCH http://localhost:3000/api/users/1/plan \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"planId":"5"}'

curl -s -X PUT http://localhost:3000/api/plans/5 \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Interns","monthlyAllowance":"500","maxUnitsPerRequest":"50"}'
```

Usage for a month (abridged response):

```bash
curl -s -H "X-API-Key: $KEY" "http://localhost:3000/api/consumption/usage?month=2026-10"
```

```json
{
  "usage": {
    "month": "2026-10",
    "account": { "id": "1", "planName": "Starter", "monthlyAllowance": "10000", "maxUnitsPerRequest": "1000", "used": "25", "remaining": "9975", "exceeded": false },
    "users": [
      { "id": "1", "externalId": "alice", "planName": "Basic", "monthlyAllowance": "1000", "maxUnitsPerRequest": "100", "used": "25", "remaining": "975", "exceeded": false }
    ]
  }
}
```

Request history, newest first, with optional filters (`month`, `userId`, `status` = `accepted` or `rejected`) and pagination (`limit` 1-100, default 20, and `offset`):

```bash
curl -s -H "X-API-Key: $KEY" \
  "http://localhost:3000/api/consumption?month=2026-10&userId=1&status=rejected&limit=20&offset=0"
```

```json
{
  "month": "2026-10",
  "items": [
    { "id": "7", "accountId": "1", "userId": "1", "requestId": "doc-43", "units": "150", "status": "rejected", "rejectionReason": "user_max_units_per_request", "createdAt": "2026-10-19T09:30:00.000Z" }
  ],
  "pagination": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

## Retry Behavior

`requestId` is unique per account. Retrying the same `requestId` with the same user and units returns the original decision with `replayed: true` and never counts twice, even if retries arrive concurrently. Reusing it with a different user or amount returns `409 idempotency_conflict`. A **rejected** request is also stored, so retrying it returns the same rejection; after fixing the cause (for example upgrading a plan), send a **new** `requestId`.

## Product Assumptions

- The only resource is generic "units"; one resource is used everywhere.
- The UTC month is decided when a request is processed. Usage is derived from stored accepted requests, so switching a plan never resets usage.
- Reducing an allowance below existing usage keeps the usage, reports zero remaining (`exceeded: true`), and rejects new consumption at that level until the allowance exceeds usage again.
- Rejected requests are recorded in history but never counted.
- Predefined plans are read-only. A custom plan cannot be deleted while assigned.
- A user is only valid inside the account that registered them; using another account's user returns `404`.
- Account and user plans both apply, and the account total is the sum of accepted units across its users.

## Design Decisions and Trade-offs

- **Usage is derived, not stored.** There is no counter to drift out of sync with history, so totals are correct by construction and plan changes cannot corrupt them. The cost is that each decision sums the account's accepted rows for the month.
- **One transaction per request, with a row lock on the account.** All requests for one account are serialized, which keeps the shared allowance correct under concurrency without retries or isolation-level tuning. Requests for different accounts proceed in parallel. This is the main scalability limit within a single account.
- **Plans are read on every request**, so a plan update applies to the next decision without a restart.
- **`UNIQUE (account_id, request_id)`** backs idempotency at the database level, not only in code.
- **A composite foreign key `(user_id, account_id)`** makes it impossible to record usage for a user under the wrong account.

## Performance Testing (correctness under load)

```bash
CONCURRENCY=50 OUT=performance/correctness-1acct-c50.json node scripts/load-test-correctness.mjs
ACCOUNTS=10 ACCOUNT_MONTHLY=300 USER_MONTHLY=100 CONCURRENCY=50 node scripts/load-test-correctness.mjs
node scripts/summarize-results.mjs
```

Variables: `REQUESTS`, `CONCURRENCY`, `ACCOUNTS`, `USERS`, `ACCOUNT_MONTHLY`, `USER_MONTHLY`, `SEED`, `OUT`. The script drives random users and amounts until allowances are hit, then verifies that the usage reported by the service equals the units the client saw accepted, per account and per user, and that no allowance was exceeded. It exits non-zero on any mismatch. Each run creates new accounts.

### Results and what I learned

Each run: 2,000 requests, 10 users per account, random 1-5 units, seed 42. Every run verified that the usage reported by the service equals the units the client saw accepted (per account and per user) and that no allowance was exceeded. Raw results are in `performance/correctness-*.json`.

| Run | Accounts | Concurrency | Req/s | p50 ms | p95 ms | p99 ms | Accepted | Rejected | HTTP errors | Totals match |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1acct-c1 | 1 | 1 | 179.26 | 5.22 | 7.88 | 10.47 | 991 | 1009 | 0 | yes |
| 1acct-c10 | 1 | 10 | 254.53 | 36.79 | 51.97 | 58.79 | 991 | 1009 | 0 | yes |
| 1acct-c50 | 1 | 50 | 232.06 | 211.55 | 257.17 | 270.30 | 991 | 1009 | 0 | yes |
| 10acct-c50 | 10 | 50 | 830.47 | 58.72 | 71.70 | 77.27 | 992 | 1008 | 0 | yes |

What the numbers show:

- **Correctness held under contention.** With 50 concurrent clients, accepted usage matched exactly and no limit was exceeded in any run. The integration tests also assert exact accepted counts for concurrent requests against small allowances.
- **Within one account, throughput stops scaling at around 10 concurrent clients** (about 250 req/s here) and extra concurrency only adds waiting: p50 latency rose from 5 ms to 37 ms to 212 ms. This matches the design: each decision locks the account row, so requests for one account are processed one at a time.
- **Across accounts, throughput scaled.** At the same concurrency of 50, ten accounts reached about 830 req/s with p50 near 59 ms, about 3.6x the single-account throughput.

Caveats: one run per configuration, with the load generator, API and database on the same machine, so absolute numbers are indicative only. The 10-account run also used a smaller allowance (300) and therefore a smaller per-account history, so part of its advantage may come from cheaper usage sums rather than the lock alone; these runs do not separate the two effects.

**Possible Future Improvement (Not Implemented):** Replace repeated monthly usage aggregation with dedicated monthly usage counters for each account and user, updated atomically within the same database transaction as each consumption decision. This would reduce query cost as usage history grows. However, account-level row locking would still be needed to enforce shared account quotas correctly under concurrent requests.
