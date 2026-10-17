
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

export type RejectionReason =
  | "account_monthly_allowance"
  | "account_max_units_per_request"
  | "user_monthly_allowance"
  | "user_max_units_per_request";

export interface ConsumptionResult {
  requestId: string;
  accountId: string;
  userId: string;
  units: string;
  status: "accepted" | "rejected";
  rejectionReason: RejectionReason | null;
  createdAt: Date;
  replayed: boolean;
}

interface ExistingRequest {
  accountId: string;
  userId: string;
  requestId: string;
  units: string;
  status: "accepted" | "rejected";
  rejectionReason: RejectionReason | null;
  createdAt: Date;
}

interface AccountPlanRow {
  id: string;
  monthlyAllowance: string;
  maxUnitsPerRequest: string;
}

interface UserPlanRow {
  id: string;
  accountId: string;
  monthlyAllowance: string;
  maxUnitsPerRequest: string;
}

async function getExistingRequest(
  client: PoolClient,
  accountId: string,
  requestId: string
): Promise<ExistingRequest | null> {
  const result = await client.query<ExistingRequest>(
    `
      SELECT
        account_id::TEXT AS "accountId",
        user_id::TEXT AS "userId",
        request_id AS "requestId",
        units::TEXT AS units,
        status,
        rejection_reason AS "rejectionReason",
        created_at AS "createdAt"
      FROM consumption_requests
      WHERE account_id = $1
        AND request_id = $2
    `,
    [accountId, requestId]
  );

  return result.rows[0] ?? null;
}

export async function consumeUnits(input: {
  accountId: string;
  userId: string;
  requestId: string;
  units: string;
}): Promise<ConsumptionResult> {
  const { accountId, userId, requestId, units } = input;
  const requestedUnits = BigInt(units);

  // Define the current month's boundaries explicitly in UTC.
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const nextMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const accountResult = await client.query<AccountPlanRow>(
      `
        SELECT
          a.id::TEXT AS id,
          p.monthly_allowance::TEXT AS "monthlyAllowance",
          p.max_units_per_request::TEXT AS "maxUnitsPerRequest"
        FROM accounts a
        JOIN plans p ON p.id = a.plan_id
        WHERE a.id = $1
        FOR UPDATE OF a
      `,
      [accountId]
    );

    const accountPlan = accountResult.rows[0];

    if (!accountPlan) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    const existing = await getExistingRequest(
      client,
      accountId,
      requestId
    );

    if (existing) {
      if (existing.userId !== userId || existing.units !== units) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }

      await client.query("COMMIT");

      return {
        ...existing,
        replayed: true
      };
    }

    const userResult = await client.query<UserPlanRow>(
      `
        SELECT
          u.id::TEXT AS id,
          u.account_id::TEXT AS "accountId",
          p.monthly_allowance::TEXT AS "monthlyAllowance",
          p.max_units_per_request::TEXT AS "maxUnitsPerRequest"
        FROM users u
        JOIN plans p ON p.id = u.plan_id
        WHERE u.id = $1
          AND u.account_id = $2
          AND p.scope = 'user'
      `,
      [userId, accountId]
    );

    const userPlan = userResult.rows[0];

    if (!userPlan) {
      throw new Error("USER_NOT_FOUND");
    }

    let rejectionReason: RejectionReason | null = null;

    if (requestedUnits > BigInt(accountPlan.maxUnitsPerRequest)) {
      rejectionReason = "account_max_units_per_request";
    } else if (requestedUnits > BigInt(userPlan.maxUnitsPerRequest)) {
      rejectionReason = "user_max_units_per_request";
    } else {
      const usageResult = await client.query<{
        accountUsed: string;
        userUsed: string;
      }>(
        `
          SELECT
            COALESCE(SUM(units), 0)::TEXT AS "accountUsed",
            COALESCE(
              SUM(units) FILTER (WHERE user_id = $2),
              0
            )::TEXT AS "userUsed"
          FROM consumption_requests
          WHERE status = 'accepted'
            AND account_id = $1
            AND created_at >= $3
            AND created_at < $4
        `,
        [accountId, userId, monthStart, nextMonthStart]
      );

      const usage = usageResult.rows[0];

      if (!usage) {
        throw new Error("USAGE_LOOKUP_FAILED");
      }

      const accountUsed = BigInt(usage.accountUsed);
      const userUsed = BigInt(usage.userUsed);

      if (
        accountUsed + requestedUnits >
        BigInt(accountPlan.monthlyAllowance)
      ) {
        rejectionReason = "account_monthly_allowance";
      } else if (
        userUsed + requestedUnits >
        BigInt(userPlan.monthlyAllowance)
      ) {
        rejectionReason = "user_monthly_allowance";
      }
    }

    const status = rejectionReason === null ? "accepted" : "rejected";

    const insertResult = await client.query<{
      accountId: string;
      userId: string;
      requestId: string;
      units: string;
      status: "accepted" | "rejected";
      rejectionReason: RejectionReason | null;
      createdAt: Date;
    }>(
      `
        INSERT INTO consumption_requests (
          account_id,
          user_id,
          request_id,
          units,
          status,
          rejection_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          account_id::TEXT AS "accountId",
          user_id::TEXT AS "userId",
          request_id AS "requestId",
          units::TEXT AS units,
          status,
          rejection_reason AS "rejectionReason",
          created_at AS "createdAt"
      `,
      [accountId, userId, requestId, units, status, rejectionReason]
    );

    const created = insertResult.rows[0];

    if (!created) {
      throw new Error("CONSUMPTION_CREATION_FAILED");
    }

    await client.query("COMMIT");

    return {
      ...created,
      replayed: false
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
