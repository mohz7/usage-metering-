import { pool } from "../db/pool.js";

export interface User {
  id: string;
  accountId: string;
  externalId: string;
  planId: string;
  planName: string;
  createdAt: Date;
}

export async function createUser(
  accountId: string,
  externalId: string,
  planId: string
): Promise<User> {
  const result = await pool.query<User>(
    `
      INSERT INTO users (account_id, external_id, plan_id)
      SELECT a.id, $2, p.id
      FROM accounts a
      CROSS JOIN plans p
      WHERE a.id = $1
        AND p.id = $3
        AND p.scope = 'user'
        AND (
          p.is_predefined = TRUE
          OR p.owner_account_id = a.id
        )
      RETURNING
        id::TEXT AS id,
        account_id::TEXT AS "accountId",
        external_id AS "externalId",
        plan_id::TEXT AS "planId",
        (SELECT name FROM plans WHERE id = plan_id) AS "planName",
        created_at AS "createdAt"
    `,
    [accountId, externalId, planId]
  );

  const user = result.rows[0];

  if (user) {
    return user;
  }

  const accountResult = await pool.query(
    "SELECT 1 FROM accounts WHERE id = $1",
    [accountId]
  );

  if (accountResult.rowCount === 0) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }

  throw new Error("USER_PLAN_NOT_FOUND");
}

export async function getUserById(
  accountId: string,
  userId: string
): Promise<User | null> {
  const result = await pool.query<User>(
    `
      SELECT
        u.id::TEXT AS id,
        u.account_id::TEXT AS "accountId",
        u.external_id AS "externalId",
        u.plan_id::TEXT AS "planId",
        p.name AS "planName",
        u.created_at AS "createdAt"
      FROM users u
      JOIN plans p ON p.id = u.plan_id
      WHERE u.account_id = $1
        AND u.id = $2
        AND (
          p.is_predefined = TRUE
          OR p.owner_account_id = u.account_id
        )
    `,
    [accountId, userId]
  );

  return result.rows[0] ?? null;
}

export async function updateUserPlan(
  accountId: string,
  userId: string,
  planId: string
): Promise<User | null> {
  const result = await pool.query<User>(
    `
      UPDATE users AS u
      SET plan_id = p.id
      FROM plans AS p
      WHERE u.account_id = $1
        AND u.id = $2
        AND p.id = $3
        AND p.scope = 'user'
        AND (
          p.is_predefined = TRUE
          OR p.owner_account_id = u.account_id
        )
      RETURNING
        u.id::TEXT AS id,
        u.account_id::TEXT AS "accountId",
        u.external_id AS "externalId",
        u.plan_id::TEXT AS "planId",
        (SELECT name FROM plans WHERE id = u.plan_id) AS "planName",
        u.created_at AS "createdAt"
    `,
    [accountId, userId, planId]
  );

  return result.rows[0] ?? null;
}
