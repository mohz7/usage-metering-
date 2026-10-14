import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

const { mockConnect, mockQuery, mockRelease } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockQuery: vi.fn(),
  mockRelease: vi.fn()
}));

vi.mock("../src/db/pool.js", () => ({
  pool: {
    connect: mockConnect
  }
}));

import { consumeUnits } from "../src/services/consumption.service.js";

const accountPlan = {
  id: "2",
  monthlyAllowance: "10000",
  maxUnitsPerRequest: "1000"
};

const userPlan = {
  id: "2",
  accountId: "2",
  monthlyAllowance: "1000",
  maxUnitsPerRequest: "100"
};

const createdAt = new Date("2026-10-14T10:00:00.000Z");

function setupDatabase(options?: {
  existingRequest?: Record<string, unknown>;
  accountUsed?: string;
  userUsed?: string;
  accountExists?: boolean;
  userExists?: boolean;
}) {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease
  });

  mockQuery.mockImplementation(
    async (sql: string, values?: unknown[]) => {
      const query = sql.replace(/\s+/g, " ").trim();

      if (
        query === "BEGIN" ||
        query === "COMMIT" ||
        query === "ROLLBACK"
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (
        query.includes("FROM accounts a") &&
        query.includes("FOR UPDATE OF a")
      ) {
        return {
          rows: options?.accountExists === false ? [] : [accountPlan],
          rowCount: options?.accountExists === false ? 0 : 1
        };
      }

      if (
        query.includes("FROM consumption_requests") &&
        query.includes("request_id = $2")
      ) {
        return {
          rows: options?.existingRequest
            ? [options.existingRequest]
            : [],
          rowCount: options?.existingRequest ? 1 : 0
        };
      }

      if (query.includes("FROM users u")) {
        return {
          rows: options?.userExists === false ? [] : [userPlan],
          rowCount: options?.userExists === false ? 0 : 1
        };
      }

      if (query.includes("COALESCE(SUM(units), 0)")) {
        return {
          rows: [
            {
              accountUsed: options?.accountUsed ?? "0",
              userUsed: options?.userUsed ?? "0"
            }
          ],
          rowCount: 1
        };
      }

      if (query.includes("INSERT INTO consumption_requests")) {
        const insertValues = values as [
          string,
          string,
          string,
          string,
          "accepted" | "rejected",
          string | null
        ];

        return {
          rows: [
            {
              accountId: insertValues[0],
              userId: insertValues[1],
              requestId: insertValues[2],
              units: insertValues[3],
              status: insertValues[4],
              rejectionReason: insertValues[5],
              createdAt
            }
          ],
          rowCount: 1
        };
      }

      throw new Error(`Unexpected SQL query: ${query}`);
    }
  );
}

describe("consumeUnits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDatabase();
  });

  it("accepts a request within the user's limits", async () => {
    const result = await consumeUnits({
      accountId: "2",
      userId: "2",
      requestId: "test-accepted-001",
      units: "50"
    });

    expect(result.status).toBe("accepted");
    expect(result.rejectionReason).toBeNull();
    expect(result.units).toBe("50");
    expect(result.replayed).toBe(false);
    expect(mockQuery).toHaveBeenCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("rejects a request above the user's per-request limit", async () => {
    const result = await consumeUnits({
      accountId: "2",
      userId: "2",
      requestId: "test-rejected-001",
      units: "101"
    });

    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toBe(
      "user_max_units_per_request"
    );
    expect(result.replayed).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("rejects a request above the account's per-request limit", async () => {
    const result = await consumeUnits({
      accountId: "2",
      userId: "2",
      requestId: "test-account-max-001",
      units: "1001"
    });

    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toBe(
      "account_max_units_per_request"
    );
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("COALESCE(SUM(units), 0)")
    );
  });

  it("accepts a request exactly at the user's per-request limit", async () => {
    const result = await consumeUnits({
      accountId: "2",
      userId: "2",
      requestId: "test-user-boundary-001",
      units: "100"
    });

    expect(result.status).toBe("accepted");
    expect(result.rejectionReason).toBeNull();
  });

  it("replays the same request without inserting it again", async () => {
    setupDatabase({
      existingRequest: {
        accountId: "2",
        userId: "2",
        requestId: "test-replay-001",
        units: "50",
        status: "accepted",
        rejectionReason: null,
        createdAt
      }
    });

    const result = await consumeUnits({
      accountId: "2",
      userId: "2",
      requestId: "test-replay-001",
      units: "50"
    });

    expect(result.status).toBe("accepted");
    expect(result.replayed).toBe(true);

    const insertCalls = mockQuery.mock.calls.filter(
      ([sql]) =>
        typeof sql === "string" &&
        sql.includes("INSERT INTO consumption_requests")
    );

    expect(insertCalls).toHaveLength(0);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("rejects a request that exceeds the account monthly allowance", async () => {
    setupDatabase({
      accountUsed: "9950",
      userUsed: "0"
    });

    const result = await consumeUnits({
      accountId: "2",
      userId: "2",
      requestId: "test-account-monthly-limit",
      units: "100"
    });

    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toBe(
      "account_monthly_allowance"
    );
  });

  it("rejects a request that exceeds the user monthly allowance", async () => {
    setupDatabase({
      accountUsed: "500",
      userUsed: "950"
    });

    const result = await consumeUnits({
      accountId: "2",
      userId: "2",
      requestId: "test-user-monthly-limit",
      units: "100"
    });

    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toBe(
      "user_monthly_allowance"
    );
  });

  it("rejects reuse of a request ID with different units", async () => {
    setupDatabase({
      existingRequest: {
        accountId: "2",
        userId: "2",
        requestId: "test-conflict-001",
        units: "50",
        status: "accepted",
        rejectionReason: null,
        createdAt
      }
    });

    await expect(
      consumeUnits({
        accountId: "2",
        userId: "2",
        requestId: "test-conflict-001",
        units: "60"
      })
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("rejects reuse of a request ID by a different user", async () => {
    setupDatabase({
      existingRequest: {
        accountId: "2",
        userId: "2",
        requestId: "test-user-conflict-001",
        units: "50",
        status: "accepted",
        rejectionReason: null,
        createdAt
      }
    });

    await expect(
      consumeUnits({
        accountId: "2",
        userId: "3",
        requestId: "test-user-conflict-001",
        units: "50"
      })
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ACCOUNT_NOT_FOUND when the account does not exist", async () => {
    setupDatabase({ accountExists: false });

    await expect(
      consumeUnits({
        accountId: "999",
        userId: "2",
        requestId: "test-missing-account",
        units: "10"
      })
    ).rejects.toThrow("ACCOUNT_NOT_FOUND");

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws USER_NOT_FOUND when the user does not belong to the account", async () => {
    setupDatabase({ userExists: false });

    await expect(
      consumeUnits({
        accountId: "2",
        userId: "999",
        requestId: "test-missing-user",
        units: "10"
      })
    ).rejects.toThrow("USER_NOT_FOUND");

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the connection when a query fails", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const query = sql.replace(/\s+/g, " ").trim();

      if (query === "BEGIN") {
        return { rows: [], rowCount: 0 };
      }

      if (
        query.includes("FROM accounts a") &&
        query.includes("FOR UPDATE OF a")
      ) {
        throw new Error("DATABASE_FAILURE");
      }

      if (query === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected SQL query: ${query}`);
    });

    await expect(
      consumeUnits({
        accountId: "2",
        userId: "2",
        requestId: "test-database-error",
        units: "10"
      })
    ).rejects.toThrow("DATABASE_FAILURE");

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});
