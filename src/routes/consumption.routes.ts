import { Router } from "express";
import { authenticateApiKey } from "../middleware/account-auth.middleware.js";
import { consumeUnits } from "../services/consumption.service.js";
import {
  getConsumptionHistory,
  getMonthlyUsage
} from "../services/consumption-history.service.js";

const consumptionRouter = Router();

consumptionRouter.use(authenticateApiKey);

function isValidMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  return year >= 1 && year <= 9999;
}

function getMonth(value: unknown): string {
  if (value === undefined) {
    return new Date().toISOString().slice(0, 7);
  }

  if (!isValidMonth(value)) {
    throw new Error("INVALID_MONTH");
  }

  return value;
}

consumptionRouter.get("/usage", async (req, res) => {
  const accountId = res.locals.accountId as string;

  let month: string;

  try {
    month = getMonth(req.query.month);
  } catch {
    res.status(400).json({
      error: "invalid_month",
      message: "Month must use YYYY-MM format"
    });
    return;
  }

  try {
    const usage = await getMonthlyUsage(accountId, month);
    res.status(200).json({ usage });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_NOT_FOUND") {
      res.status(404).json({ error: "account_not_found" });
      return;
    }

    console.error("Failed to get monthly usage:", error);
    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to get monthly usage"
    });
  }
});

consumptionRouter.get("/", async (req, res) => {
  const accountId = res.locals.accountId as string;

  let month: string;

  try {
    month = getMonth(req.query.month);
  } catch {
    res.status(400).json({
      error: "invalid_month",
      message: "Month must use YYYY-MM format"
    });
    return;
  }

  const userId = req.query.userId;
  if (
    userId !== undefined &&
    (typeof userId !== "string" || !/^[1-9]\d*$/.test(userId))
  ) {
    res.status(400).json({
      error: "invalid_user_id",
      message: "User ID must be a positive integer"
    });
    return;
  }

  const status = req.query.status;
  if (
    status !== undefined &&
    status !== "accepted" &&
    status !== "rejected"
  ) {
    res.status(400).json({
      error: "invalid_status",
      message: "Status must be accepted or rejected"
    });
    return;
  }

  const rawLimit = req.query.limit ?? "20";
  const rawOffset = req.query.offset ?? "0";

  if (
    typeof rawLimit !== "string" ||
    !/^\d+$/.test(rawLimit) ||
    Number(rawLimit) < 1 ||
    Number(rawLimit) > 100
  ) {
    res.status(400).json({
      error: "invalid_limit",
      message: "Limit must be an integer between 1 and 100"
    });
    return;
  }

  if (
    typeof rawOffset !== "string" ||
    !/^\d+$/.test(rawOffset) ||
    !Number.isSafeInteger(Number(rawOffset))
  ) {
    res.status(400).json({
      error: "invalid_offset",
      message: "Offset must be a non-negative integer"
    });
    return;
  }

  try {
    const history = await getConsumptionHistory({
      accountId,
      userId: userId as string | undefined,
      status: status as "accepted" | "rejected" | undefined,
      month,
      limit: Number(rawLimit),
      offset: Number(rawOffset)
    });

    res.status(200).json(history);
  } catch (error) {
    console.error("Failed to get consumption history:", error);
    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to get consumption history"
    });
  }
});

consumptionRouter.post("/", async (req, res) => {
  const accountId = res.locals.accountId as string;
  const { userId, requestId, units } = req.body ?? {};

  if (
    (typeof userId !== "string" && typeof userId !== "number") ||
    !/^[1-9]\d*$/.test(String(userId))
  ) {
    res.status(400).json({
      error: "invalid_user_id",
      message: "User ID must be a positive integer"
    });
    return;
  }

  if (
    typeof requestId !== "string" ||
    requestId.trim().length < 1 ||
    requestId.trim().length > 200
  ) {
    res.status(400).json({
      error: "invalid_request_id",
      message: "Request ID must be between 1 and 200 characters"
    });
    return;
  }

  if (
    (typeof units !== "string" && typeof units !== "number") ||
    !/^[1-9]\d*$/.test(String(units))
  ) {
    res.status(400).json({
      error: "invalid_units",
      message: "Units must be a positive integer"
    });
    return;
  }

  try {
    const result = await consumeUnits({
      accountId,
      userId: String(userId),
      requestId: requestId.trim(),
      units: String(units)
    });

    res.status(200).json({ consumption: result });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_NOT_FOUND") {
      res.status(404).json({
        error: "account_not_found",
        message: "Account was not found"
      });
      return;
    }

    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      res.status(404).json({
        error: "user_not_found",
        message: "User was not found in this account"
      });
      return;
    }

    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") {
      res.status(409).json({
        error: "idempotency_conflict",
        message: "This request ID was already used with different input"
      });
      return;
    }

    console.error("Failed to record consumption:", error);

    res.status(500).json({
      error: "internal_server_error",
      message: "Failed to record consumption"
    });
  }
});

export default consumptionRouter;
