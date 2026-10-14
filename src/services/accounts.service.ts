import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";

export interface Account {
  id: string;
  name: string;
  planId: string;
  planName: string;
  createdAt: Date;
}

export interface CreatedAccount {
  account: Account;
  apiKey: string;
}

interface AccountRow {
  id: string;
  name: string;
  planId: string;
  planName: string;
  createdAt: Date;
}

export async function createAccount(
  name: string,
  planId: string
): Promise<CreatedAccount> {
  const apiKey = `um_${randomBytes(32).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const planResult = await client.query<{
      id: string;
      name: string;
    }>(
      `
        SELECT id::TEXT AS id, name
        FROM plans
        WHERE id = $1
          AND scope = 'account'
          AND is_predefined = TRUE
      `,
      [planId]
    );

    if (!planResult.rows[0]) {
      throw new Error("ACCOUNT_PLAN_NOT_FOUND");
    }

    const accountResult = await client.query<AccountRow>(
      `
        INSERT INTO accounts (name, api_key_hash, plan_id)
        VALUES ($1, $2, $3)
        RETURNING
          id::TEXT AS id,
          name,
          plan_id::TEXT AS "planId",
          (SELECT name FROM plans WHERE id = plan_id) AS "planName",
          created_at AS "createdAt"
      `,
      [name, apiKeyHash, planId]
    );

    const account = accountResult.rows[0];

    if (!account) {
      throw new Error("ACCOUNT_CREATION_FAILED");
    }

    await client.query("COMMIT");

    return { account, apiKey };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAccountById(
  id: string
): Promise<Account | null> {
  const result = await pool.query<Account>(
    `
      SELECT
        a.id::TEXT AS id,
        a.name,
        a.plan_id::TEXT AS "planId",
        p.name AS "planName",
        a.created_at AS "createdAt"
      FROM accounts a
      JOIN plans p ON p.id = a.plan_id
      WHERE a.id = $1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function updateAccountPlan(
  accountId: string,
  planId: string
): Promise<Account | null> {
  const result = await pool.query<Account>(
    `
      UPDATE accounts AS a
      SET plan_id = p.id
      FROM plans AS p
      WHERE a.id = $1
        AND p.id = $2
        AND p.scope = 'account'
        AND (
          p.is_predefined = TRUE
          OR p.owner_account_id = a.id
        )
      RETURNING
        a.id::TEXT AS id,
        a.name,
        a.plan_id::TEXT AS "planId",
        p.name AS "planName",
        a.created_at AS "createdAt"
    `,
    [accountId, planId]
  );

  return result.rows[0] ?? null;
}
