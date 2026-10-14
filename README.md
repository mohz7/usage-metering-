# Usage Metering and Quota Service

A REST API built with TypeScript, Express, and PostgreSQL to track consumption and enforce usage quotas for accounts and users.

## Features

- API key authentication
- Account and user management
- Predefined and custom usage plans
- Monthly usage quotas
- Per-request consumption limits
- Idempotent consumption requests
- Consumption history with pagination and filters
- Monthly usage summaries
- PostgreSQL persistence
- Automated tests

## Technology Stack

- Node.js
- TypeScript
- Express
- PostgreSQL
- Docker Compose
- Vitest

## Prerequisites

- Node.js and npm
- Docker with Docker Compose

## Configuration

Create a local `.env` file with the database connection variable expected by `src/db/pool.ts`.

Keep `.env` private. Never commit API keys, database passwords, or other secrets.

## Installation

Install dependencies:

```bash
npm install
```

Start PostgreSQL:

```bash
docker compose up -d db
```

Initialize the database only when setting up a new, empty database:

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

**Warning:** Do not run the schema against an existing database without reviewing its SQL first.

## Running the Application

Start the development server:

```bash
npm run dev
```

Build the application:

```bash
npm run build
```

Start the compiled application:

```bash
npm start
```

## Testing

Run the automated test suite:

```bash
npm test
```

## Health Endpoints

- `GET /health/live` — checks whether the service is running.
- `GET /health/ready` — checks whether the service can connect to PostgreSQL.

## API Routes

The API includes the following route groups:

- `/api/accounts`
- `/api/users`
- `/api/plans`
- `/api/consumption`

Protected endpoints require account API key authentication.

For supported operations and request validation, see the route files under `src/routes/`.

## Database Persistence

PostgreSQL is configured in `compose.yaml` and stores data in a named Docker volume.

Avoid deleting Docker volumes or running destructive database commands when existing data must be preserved.

## Security

- Do not commit `.env` or secrets.
- Use secure credentials in deployed environments.
- Validate authentication and account ownership for protected operations.