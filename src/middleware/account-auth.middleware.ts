import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { pool } from "../db/pool.js";

interface AccountIdRow {
  id: string;
}

export const authenticateApiKey: RequestHandler = async (
  req,
  res,
  next
) => {
  const apiKey = req.header("x-api-key");

  if (!apiKey) {
    res.status(401).json({
      error: "missing_api_key",
      message: "Provide an API key using the x-api-key header"
    });
    return;
  }

  if (!/^um_[a-f0-9]{64}$/.test(apiKey)) {
    res.status(401).json({
      error: "invalid_api_key",
      message: "The API key is invalid"
    });
    return;
  }

  try {
    const apiKeyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const result = await pool.query<AccountIdRow>(
      `
        SELECT id::TEXT AS id
        FROM accounts
        WHERE api_key_hash = $1
      `,
      [apiKeyHash]
    );

    const account = result.rows[0];

    if (!account) {
      res.status(401).json({
        error: "invalid_api_key",
        message: "The API key is invalid"
      });
      return;
    }

    res.locals.accountId = account.id;
    next();
  } catch (error) {
    console.error("API key authentication failed:", error);

    res.status(503).json({
      error: "authentication_unavailable",
      message: "Authentication is temporarily unavailable"
    });
  }
};
