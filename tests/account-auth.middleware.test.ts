import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: vi.fn()
  }
}));

import { pool } from "../src/db/pool.js";
import { authenticateApiKey } from "../src/middleware/account-auth.middleware.js";

const mockedQuery = vi.mocked(pool.query);

function makeRequest(apiKey?: string) {
  return {
    header: vi.fn((name: string) =>
      name === "x-api-key" ? apiKey : undefined
    )
  };
}

function makeResponse() {
  const res = {
    locals: {} as Record<string, unknown>,
    status: vi.fn(),
    json: vi.fn()
  };

  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);

  return res;
}

describe("authenticateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request without an API key", async () => {
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await authenticateApiKey(
      req as unknown as Request,
      res as unknown as Response,
      next
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "missing_api_key"
      })
    );
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed API key without querying the database", async () => {
    const req = makeRequest("invalid-key");
    const res = makeResponse();
    const next = vi.fn();

    await authenticateApiKey(
      req as unknown as Request,
      res as unknown as Response,
      next
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "invalid_api_key"
      })
    );
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("authenticates a valid API key and sets the account ID", async () => {
    const apiKey = `um_${"a".repeat(64)}`;
    const req = makeRequest(apiKey);
    const res = makeResponse();
    const next = vi.fn();

    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: "42" }],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: []
    });

    await authenticateApiKey(
      req as unknown as Request,
      res as unknown as Response,
      next
    );

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE api_key_hash = $1"),
      [expect.any(String)]
    );
    expect(res.locals.accountId).toBe("42");
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a well-formed API key that is not registered", async () => {
    const apiKey = `um_${"b".repeat(64)}`;
    const req = makeRequest(apiKey);
    const res = makeResponse();
    const next = vi.fn();

    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: "SELECT",
      oid: 0,
      fields: []
    });

    await authenticateApiKey(
      req as unknown as Request,
      res as unknown as Response,
      next
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "invalid_api_key"
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 if the database is unavailable", async () => {
    const apiKey = `um_${"c".repeat(64)}`;
    const req = makeRequest(apiKey);
    const res = makeResponse();
    const next = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mockedQuery.mockRejectedValueOnce(new Error("Database unavailable"));

    try {
      await authenticateApiKey(
        req as unknown as Request,
        res as unknown as Response,
        next
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "authentication_unavailable"
        })
      );
      expect(next).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
