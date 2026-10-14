import { Router } from "express";
import { authenticateApiKey } from "../middleware/account-auth.middleware.js";
import {
  createCustomPlan,
  deleteCustomPlan,
  getAllPlans,
  getPlanById,
  updateCustomPlan
} from "../services/plans.service.js";

const plansRouter = Router();

plansRouter.use(authenticateApiKey);

const MAX_POSTGRES_BIGINT = 9223372036854775807n;

function parseInteger(
  value: unknown,
  allowZero: boolean
): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    return null;
  }

  const text = String(value);

  if (!/^(0|[1-9]\d*)$/.test(text)) {
    return null;
  }

  try {
    const parsed = BigInt(text);

    if (parsed > MAX_POSTGRES_BIGINT) {
      return null;
    }

    if (allowZero ? parsed < 0n : parsed < 1n) {
      return null;
    }

    return text;
  } catch {
    return null;
  }
}

function validatePlanBody(body: unknown):
  | {
      name: string;
      scope: "account" | "user";
      monthlyAllowance: string;
      maxUnitsPerRequest: string;
    }
  | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const data = body as Record<string, unknown>;

  if (
    typeof data.name !== "string" ||
    data.name.trim().length < 2 ||
    data.name.trim().length > 100
  ) {
    return null;
  }

  if (data.scope !== "account" && data.scope !== "user") {
    return null;
  }

  const monthlyAllowance = parseInteger(data.monthlyAllowance, true);
  const maxUnitsPerRequest = parseInteger(data.maxUnitsPerRequest, false);

  if (monthlyAllowance === null || maxUnitsPerRequest === null) {
    return null;
  }

  return {
    name: data.name.trim(),
    scope: data.scope,
    monthlyAllowance,
    maxUnitsPerRequest
  };
}

function validatePlanUpdateBody(body: unknown):
  | {
      name: string;
      monthlyAllowance: string;
      maxUnitsPerRequest: string;
    }
  | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const data = body as Record<string, unknown>;

  if (
    typeof data.name !== "string" ||
    data.name.trim().length < 2 ||
    data.name.trim().length > 100
  ) {
    return null;
  }

  const monthlyAllowance = parseInteger(data.monthlyAllowance, true);
  const maxUnitsPerRequest = parseInteger(data.maxUnitsPerRequest, false);

  if (monthlyAllowance === null || maxUnitsPerRequest === null) {
    return null;
  }

  return {
    name: data.name.trim(),
    monthlyAllowance,
    maxUnitsPerRequest
  };
}

function isPostgresError(
  error: unknown,
  code: string
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

plansRouter.get("/", async (_req, res) => {
  const accountId = res.locals.accountId as string;

  try {
    const plans = await getAllPlans(accountId);

    res.status(200).json({
      plans,
      count: plans.length
    });
  } catch (error) {
    console.error("Failed to fetch plans:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to fetch plans"
    });
  }
});

plansRouter.post("/", async (req, res) => {
  const accountId = res.locals.accountId as string;
  const input = validatePlanBody(req.body);

  if (!input) {
    res.status(400).json({
      error: "invalid_plan",
      message:
        "Provide a name (2-100 characters), scope (account or user), a non-negative monthly allowance, and a positive maximum per request"
    });
    return;
  }

  try {
    const plan = await createCustomPlan(accountId, input);

    res.status(201).json({ plan });
  } catch (error) {
    if (isPostgresError(error, "23505")) {
      res.status(409).json({
        error: "duplicate_plan",
        message: "A plan with this name and scope already exists in your account"
      });
      return;
    }

    console.error("Failed to create plan:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to create plan"
    });
  }
});

plansRouter.get("/:id", async (req, res) => {
  const id = req.params.id;
  const accountId = res.locals.accountId as string;

  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) {
    res.status(400).json({
      error: "invalid_plan_id",
      message: "Plan ID must be a positive integer"
    });
    return;
  }

  try {
    const plan = await getPlanById(id, accountId);

    if (!plan) {
      res.status(404).json({
        error: "plan_not_found",
        message: "Plan was not found"
      });
      return;
    }

    res.status(200).json({ plan });
  } catch (error) {
    console.error("Failed to fetch plan:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to fetch plan"
    });
  }
});

plansRouter.put("/:id", async (req, res) => {
  const id = req.params.id;
  const accountId = res.locals.accountId as string;
  const input = validatePlanUpdateBody(req.body);

  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) {
    res.status(400).json({
      error: "invalid_plan_id",
      message: "Plan ID must be a positive integer"
    });
    return;
  }

  if (!input) {
    res.status(400).json({
      error: "invalid_plan",
      message:
        "Provide a name (2-100 characters), a non-negative monthly allowance, and a positive maximum per request"
    });
    return;
  }

  try {
    const plan = await updateCustomPlan(accountId, id, input);

    if (!plan) {
      res.status(404).json({
        error: "custom_plan_not_found",
        message: "Custom plan was not found in this account"
      });
      return;
    }

    res.status(200).json({ plan });
  } catch (error) {
    if (isPostgresError(error, "23505")) {
      res.status(409).json({
        error: "duplicate_plan",
        message: "A plan with this name and scope already exists in your account"
      });
      return;
    }

    console.error("Failed to update plan:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to update plan"
    });
  }
});

plansRouter.delete("/:id", async (req, res) => {
  const id = req.params.id;
  const accountId = res.locals.accountId as string;

  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) {
    res.status(400).json({
      error: "invalid_plan_id",
      message: "Plan ID must be a positive integer"
    });
    return;
  }

  try {
    const deleted = await deleteCustomPlan(accountId, id);

    if (!deleted) {
      res.status(404).json({
        error: "custom_plan_not_found",
        message: "Custom plan was not found in this account"
      });
      return;
    }

    res.status(200).json({
      message: "Custom plan deleted successfully"
    });
  } catch (error) {
    if (isPostgresError(error, "23503")) {
      res.status(409).json({
        error: "plan_in_use",
        message: "This plan is assigned to an account or user and cannot be deleted"
      });
      return;
    }

    console.error("Failed to delete plan:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to delete plan"
    });
  }
});

export default plansRouter;