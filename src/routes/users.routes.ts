import { Router } from "express";
import { authenticateApiKey } from "../middleware/account-auth.middleware.js";
import {
  createUser,
  getUserById,
  updateUserPlan
} from "../services/users.service.js";

const usersRouter = Router();

usersRouter.use(authenticateApiKey);

usersRouter.post("/", async (req, res) => {
  const accountId = res.locals.accountId as string;
  const { externalId, planId } = req.body ?? {};

  if (
    typeof externalId !== "string" ||
    externalId.trim().length < 1 ||
    externalId.trim().length > 200
  ) {
    res.status(400).json({
      error: "invalid_external_id",
      message: "External ID must be between 1 and 200 characters"
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
    const user = await createUser(
      accountId,
      externalId.trim(),
      String(planId)
    );

    res.status(201).json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_NOT_FOUND") {
      res.status(404).json({
        error: "account_not_found",
        message: "Account was not found"
      });
      return;
    }

    if (error instanceof Error && error.message === "USER_PLAN_NOT_FOUND") {
      res.status(400).json({
        error: "invalid_user_plan",
        message: "The selected plan does not exist or is not available to this account"
      });
      return;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({
        error: "duplicate_external_id",
        message: "This external ID already exists in the account"
      });
      return;
    }

    console.error("Failed to create user:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to create user"
    });
  }
});

usersRouter.patch("/:id/plan", async (req, res) => {
  const accountId = res.locals.accountId as string;
  const userId = req.params.id;
  const { planId } = req.body ?? {};

  if (typeof userId !== "string" || !/^[1-9]\d*$/.test(userId)) {
    res.status(400).json({
      error: "invalid_user_id",
      message: "User ID must be a positive integer"
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
    const user = await updateUserPlan(accountId, userId, String(planId));

    if (user) {
      res.status(200).json({
        user,
        message: "User plan updated successfully"
      });
      return;
    }

    const existingUser = await getUserById(accountId, userId);

    if (!existingUser) {
      res.status(404).json({
        error: "user_not_found",
        message: "User was not found in this account"
      });
      return;
    }

    res.status(400).json({
      error: "invalid_user_plan",
      message: "The selected plan does not exist or is not available to this account"
    });
  } catch (error) {
    console.error("Failed to update user plan:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to update user plan"
    });
  }
});

usersRouter.get("/:id", async (req, res) => {
  const accountId = res.locals.accountId as string;
  const userId = req.params.id;

  if (typeof userId !== "string" || !/^[1-9]\d*$/.test(userId)) {
    res.status(400).json({
      error: "invalid_user_id",
      message: "User ID must be a positive integer"
    });
    return;
  }

  try {
    const user = await getUserById(accountId, userId);

    if (!user) {
      res.status(404).json({
        error: "user_not_found",
        message: "User was not found in this account"
      });
      return;
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error("Failed to fetch user:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to fetch user"
    });
  }
});

export default usersRouter;
