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

Build and start only the API and PostgreSQL services:

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

The example client demonstrates account and user quota enforcement, rejection reasons, and the effect of changing a plan.

With the Compose stack running, execute:

```bash
docker compose run --rm demo-client
```

The client creates a separate demo account, a custom account plan, and two users. It demonstrates:

- An accepted consumption request.
- A per-request user limit rejection.
- Shared account quota exhaustion.
- An account plan upgrade and a subsequent accepted request.

Each run creates additional demo data. Run it only when you want a new demonstration.

## Automated Tests

Run the test suite:

```bash
npm test
```

Build the project:

```bash
npm run build
```

Run the test suite with code coverage:

```bash
npm run test:coverage
```

The coverage command reports statement, branch, function, and line coverage. Coverage reports are generated locally and should be reviewed alongside the test results.

The automated tests cover health checks, API-key authentication, consumption service behavior, plan changes, and plan routes.

## Performance Testing

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

## Limitations and Assumptions

- Monthly usage is calculated using UTC calendar months, with inclusive start and exclusive end boundaries.
- Rejected requests are stored for audit/history purposes but do not consume quota.
- Custom plans are owned by an account and cannot be changed by another account through authenticated routes.
- The included performance test is a basic local benchmark, not a full stress, soak, or distributed-load test.
- Production deployment should additionally use managed secrets, HTTPS, monitoring, backups, and an appropriate database migration strategy.

## Repository Layout

```text
.
├── examples/
│   └── demo-client.mjs
├── performance/
│   └── load-test-results.json
├── scripts/
│   └── load-test.mjs
├── sql/
│   └── schema.sql
├── src/
│   ├── db/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   └── index.ts
├── tests/
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

## Testing

```bash
npm test                                                     # unit and route tests (database mocked)
API_URL=http://localhost:3000 npm run test:integration       # real PostgreSQL: concurrency, idempotency, isolation, plan changes
```

The integration tests send concurrent requests against small allowances and assert that exactly the allowed number is accepted and totals are exact.

## Performance Testing (correctness under load)

```bash
CONCURRENCY=50 OUT=performance/correctness-1acct-c50.json node scripts/load-test-correctness.mjs
ACCOUNTS=10 ACCOUNT_MONTHLY=300 USER_MONTHLY=100 CONCURRENCY=50 node scripts/load-test-correctness.mjs
node scripts/summarize-results.mjs
```

Variables: `REQUESTS`, `CONCURRENCY`, `ACCOUNTS`, `USERS`, `ACCOUNT_MONTHLY`, `USER_MONTHLY`, `SEED`, `OUT`. The script drives random users and amounts until allowances are hit, then verifies that the usage reported by the service equals the units the client saw accepted, per account and per user, and that no allowance was exceeded. It exits non-zero on any mismatch. Each run creates new accounts.
