import { Router } from "express";
import {
  createAccount,
  getAccountById,
  updateAccountPlan
} from "../services/accounts.service.js";
import { authenticateApiKey } from "../middleware/account-auth.middleware.js";

const accountsRouter = Router();

accountsRouter.post("/", async (req, res) => {
  const { name, planId } = req.body ?? {};

  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > 100
  ) {
    res.status(400).json({
      error: "invalid_account_name",
      message: "Account name must be between 2 and 100 characters"
    });
    return;
  }

  if (
    (typeof planId !== "string" && typeof planId !== "number") ||
    !/^[1-9]\d*$/.test(String(planId))
  ) {
    res.status(400).json({
      error: "invalid_plan_id",
      message: "Plan ID must be a positive integer"
    });
    return;
  }

  try {
    const created = await createAccount(name.trim(), String(planId));

    res.status(201).json({
      account: created.account,
      apiKey: created.apiKey,
      message: "Save this API key now. It cannot be retrieved later."
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "ACCOUNT_PLAN_NOT_FOUND"
    ) {
      res.status(400).json({
        error: "invalid_account_plan",
        message: "The selected plan does not exist or is not an account plan"
      });
      return;
    }

    console.error("Failed to create account:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to create account"
    });
  }
});

accountsRouter.patch("/:id/plan", authenticateApiKey, async (req, res) => {
  const id = req.params.id;
  const authenticatedAccountId = res.locals.accountId as string;
  const { planId } = req.body ?? {};

  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) {
    res.status(400).json({
      error: "invalid_account_id",
      message: "Account ID must be a positive integer"
    });
    return;
  }

  if (id !== authenticatedAccountId) {
    res.status(404).json({
      error: "account_not_found",
      message: "Account was not found"
    });
    return;
  }

  if (
    (typeof planId !== "string" && typeof planId !== "number") ||
    !/^[1-9]\d*$/.test(String(planId))
  ) {
    res.status(400).json({
      error: "invalid_plan_id",
      message: "Plan ID must be a positive integer"
    });
    return;
  }

  try {
    const account = await updateAccountPlan(id, String(planId));

    if (!account) {
      res.status(400).json({
        error: "invalid_account_plan",
        message: "The selected plan does not exist or is not available to this account"
      });
      return;
    }

    res.status(200).json({
      account,
      message: "Account plan updated successfully"
    });
  } catch (error) {
    console.error("Failed to update account plan:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to update account plan"
    });
  }
});

accountsRouter.get("/:id", authenticateApiKey, async (req, res) => {
  const id = req.params.id;
  const authenticatedAccountId = res.locals.accountId as string;

  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) {
    res.status(400).json({
      error: "invalid_account_id",
      message: "Account ID must be a positive integer"
    });
    return;
  }

  if (id !== authenticatedAccountId) {
    res.status(404).json({
      error: "account_not_found",
      message: "Account was not found"
    });
    return;
  }

  try {
    const account = await getAccountById(id);

    if (!account) {
      res.status(404).json({
        error: "account_not_found",
        message: "Account was not found"
      });
      return;
    }

    res.status(200).json({ account });
  } catch (error) {
    console.error("Failed to fetch account:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to fetch account"
    });
  }
});

export default accountsRouter;
