import { pool } from "../db/pool.js";

export interface Plan {
  id: string;
  name: string;
  scope: "account" | "user";
  isPredefined: boolean;
  ownerAccountId: string | null;
  monthlyAllowance: string;
  maxUnitsPerRequest: string;
  createdAt: Date;
}

export interface NewCustomPlan {
  name: string;
  scope: "account" | "user";
  monthlyAllowance: string;
  maxUnitsPerRequest: string;
}

export interface UpdateCustomPlan {
  name: string;
  monthlyAllowance: string;
  maxUnitsPerRequest: string;
}

const planSelect = `
  SELECT
    id::TEXT AS id,
    name,
    scope,
    is_predefined AS "isPredefined",
    owner_account_id::TEXT AS "ownerAccountId",
    monthly_allowance::TEXT AS "monthlyAllowance",
    max_units_per_request::TEXT AS "maxUnitsPerRequest",
    created_at AS "createdAt"
  FROM plans
`;

export async function getAllPlans(accountId: string): Promise<Plan[]> {
  const result = await pool.query<Plan>(
    `
      ${planSelect}
      WHERE is_predefined = TRUE
         OR owner_account_id = $1
      ORDER BY scope ASC, monthly_allowance ASC, id ASC
    `,
    [accountId]
  );

  return result.rows;
}

export async function getPlanById(
  id: string,
  accountId: string
): Promise<Plan | null> {
  const result = await pool.query<Plan>(
    `
      ${planSelect}
      WHERE id = $1
        AND (
          is_predefined = TRUE
          OR owner_account_id = $2
        )
    `,
    [id, accountId]
  );

  return result.rows[0] ?? null;
}

export async function createCustomPlan(
  accountId: string,
  input: NewCustomPlan
): Promise<Plan> {
  const result = await pool.query<Plan>(
    `
      INSERT INTO plans (
        name,
        scope,
        is_predefined,
        owner_account_id,
        monthly_allowance,
        max_units_per_request
      )
      VALUES ($1, $2, FALSE, $3, $4, $5)
      RETURNING
        id::TEXT AS id,
        name,
        scope,
        is_predefined AS "isPredefined",
        owner_account_id::TEXT AS "ownerAccountId",
        monthly_allowance::TEXT AS "monthlyAllowance",
        max_units_per_request::TEXT AS "maxUnitsPerRequest",
        created_at AS "createdAt"
    `,
    [
      input.name,
      input.scope,
      accountId,
      input.monthlyAllowance,
      input.maxUnitsPerRequest
    ]
  );

  const plan = result.rows[0];

  if (!plan) {
    throw new Error("PLAN_CREATION_FAILED");
  }

  return plan;
}

export async function updateCustomPlan(
  accountId: string,
  planId: string,
  input: UpdateCustomPlan
): Promise<Plan | null> {
  const result = await pool.query<Plan>(
    `
      UPDATE plans
      SET
        name = $3,
        monthly_allowance = $4,
        max_units_per_request = $5
      WHERE id = $1
        AND owner_account_id = $2
        AND is_predefined = FALSE
      RETURNING
        id::TEXT AS id,
        name,
        scope,
        is_predefined AS "isPredefined",
        owner_account_id::TEXT AS "ownerAccountId",
        monthly_allowance::TEXT AS "monthlyAllowance",
        max_units_per_request::TEXT AS "maxUnitsPerRequest",
        created_at AS "createdAt"
    `,
    [
      planId,
      accountId,
      input.name,
      input.monthlyAllowance,
      input.maxUnitsPerRequest
    ]
  );

  return result.rows[0] ?? null;
}

export async function deleteCustomPlan(
  accountId: string,
  planId: string
): Promise<boolean> {
  const result = await pool.query(
    `
      DELETE FROM plans
      WHERE id = $1
        AND owner_account_id = $2
        AND is_predefined = FALSE
      RETURNING id
    `,
    [planId, accountId]
  );

  return (result.rowCount ?? 0) > 0;
}