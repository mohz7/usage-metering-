import { pool } from "../db/pool.js";

export interface ConsumptionHistoryFilters {
  accountId: string;
  userId?: string | undefined;
  status?: "accepted" | "rejected" | undefined;
  month: string;
  limit: number;
  offset: number;
}

export interface ConsumptionHistoryItem {
  id: string;
  accountId: string;
  userId: string;
  requestId: string;
  units: string;
  status: "accepted" | "rejected";
  rejectionReason: string | null;
  createdAt: Date;
}

export async function getConsumptionHistory(
  filters: ConsumptionHistoryFilters
) {
  const { accountId, userId, status, month, limit, offset } = filters;

  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
  );

  const conditions = [
    "account_id = $1",
    "created_at >= $2",
    "created_at < $3"
  ];

  const values: unknown[] = [accountId, start, end];

  if (userId !== undefined) {
    values.push(userId);
    conditions.push(`user_id = $${values.length}`);
  }

  if (status !== undefined) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await pool.query<{ total: string }>(
    `
      SELECT COUNT(*)::TEXT AS total
      FROM consumption_requests
      WHERE ${whereClause}
    `,
    values
  );

  const total = Number(countResult.rows[0]?.total ?? "0");

  const pageValues = [...values, limit, offset];

  const result = await pool.query<ConsumptionHistoryItem>(
    `
      SELECT
        id::TEXT AS id,
        account_id::TEXT AS "accountId",
        user_id::TEXT AS "userId",
        request_id AS "requestId",
        units::TEXT AS units,
        status,
        rejection_reason AS "rejectionReason",
        created_at AS "createdAt"
      FROM consumption_requests
      WHERE ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `,
    pageValues
  );

  return {
    month,
    items: result.rows,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + result.rows.length < total
    }
  };
}

export async function getMonthlyUsage(accountId: string, month: string) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
  );

  const accountResult = await pool.query<{
    id: string;
    planId: string;
    planName: string;
    monthlyAllowance: string;
    maxUnitsPerRequest: string;
    used: string;
  }>(
    `
      SELECT
        a.id::TEXT AS id,
        p.id::TEXT AS "planId",
        p.name AS "planName",
        p.monthly_allowance::TEXT AS "monthlyAllowance",
        p.max_units_per_request::TEXT AS "maxUnitsPerRequest",
        COALESCE(
          SUM(c.units) FILTER (WHERE c.status = 'accepted'),
          0
        )::TEXT AS used
      FROM accounts a
      JOIN plans p ON p.id = a.plan_id
      LEFT JOIN consumption_requests c
        ON c.account_id = a.id
        AND c.created_at >= $2
        AND c.created_at < $3
      WHERE a.id = $1
      GROUP BY
        a.id,
        p.id,
        p.name,
        p.monthly_allowance,
        p.max_units_per_request
    `,
    [accountId, start, end]
  );

  const account = accountResult.rows[0];

  if (!account) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }

  const usersResult = await pool.query<{
    id: string;
    externalId: string;
    planId: string;
    planName: string;
    monthlyAllowance: string;
    maxUnitsPerRequest: string;
    used: string;
  }>(
    `
      SELECT
        u.id::TEXT AS id,
        u.external_id AS "externalId",
        p.id::TEXT AS "planId",
        p.name AS "planName",
        p.monthly_allowance::TEXT AS "monthlyAllowance",
        p.max_units_per_request::TEXT AS "maxUnitsPerRequest",
        COALESCE(
          SUM(c.units) FILTER (WHERE c.status = 'accepted'),
          0
        )::TEXT AS used
      FROM users u
      JOIN plans p ON p.id = u.plan_id
      LEFT JOIN consumption_requests c
        ON c.user_id = u.id
        AND c.account_id = u.account_id
        AND c.created_at >= $2
        AND c.created_at < $3
      WHERE u.account_id = $1
      GROUP BY
        u.id,
        u.external_id,
        p.id,
        p.name,
        p.monthly_allowance,
        p.max_units_per_request
      ORDER BY u.id ASC
    `,
    [accountId, start, end]
  );

  function addRemaining<T extends {
    monthlyAllowance: string;
    used: string;
  }>(item: T) {
    const allowance = BigInt(item.monthlyAllowance);
    const used = BigInt(item.used);

    return {
      ...item,
      remaining: (allowance > used ? allowance - used : 0n).toString(),
      exceeded: used > allowance
    };
  }

  return {
    month,
    account: addRemaining(account),
    users: usersResult.rows.map(addRemaining)
  };
}
