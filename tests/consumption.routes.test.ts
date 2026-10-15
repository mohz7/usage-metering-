import { createServer, type Server } from "node:http";
import type { Request, Response, NextFunction } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

const mocks = vi.hoisted(() => ({
  consumeUnits: vi.fn(),
  getConsumptionHistory: vi.fn(),
  getMonthlyUsage: vi.fn()
}));

vi.mock("../src/services/consumption.service.js", () => ({
  consumeUnits: mocks.consumeUnits
}));

vi.mock("../src/services/consumption-history.service.js", () => ({
  getConsumptionHistory: mocks.getConsumptionHistory,
  getMonthlyUsage: mocks.getMonthlyUsage
}));

vi.mock("../src/middleware/account-auth.middleware.js", () => ({
  authenticateApiKey: (
    _req: Request,
    res: Response,
    next: NextFunction
  ) => {
    res.locals.accountId = "5";
    next();
  }
}));

import express from "express";
import consumptionRouter from "../src/routes/consumption.routes.js";

const app = express();
app.use(express.json());
app.use("/api/consumption", consumptionRouter);

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Could not determine test server address"));
        return;
      }

      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function get(path: string) {
  return fetch(`${baseUrl}/api/consumption${path}`);
}

async function post(body: unknown) {
  return fetch(`${baseUrl}/api/consumption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("GET /api/consumption", () => {
  it.each([
    "2026-13",
    "2026-00",
    "26-01",
    "2026/10",
    "invalid"
  ])("rejects invalid month %s", async (month) => {
    const response = await get(`/?month=${month}`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_month");
    expect(mocks.getConsumptionHistory).not.toHaveBeenCalled();
  });

  it("rejects an invalid user ID", async () => {
    const response = await get("/?userId=0");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_user_id");
    expect(mocks.getConsumptionHistory).not.toHaveBeenCalled();
  });

  it("rejects an invalid status", async () => {
    const response = await get("/?status=pending");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_status");
    expect(mocks.getConsumptionHistory).not.toHaveBeenCalled();
  });

  it.each(["0", "101", "-1", "abc", "1.5"])(
    "rejects invalid limit %s",
    async (limit) => {
      const response = await get(`/?limit=${limit}`);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("invalid_limit");
      expect(mocks.getConsumptionHistory).not.toHaveBeenCalled();
    }
  );

  it.each(["-1", "1.5", "abc", "9007199254740992"])(
    "rejects invalid offset %s",
    async (offset) => {
      const response = await get(`/?offset=${offset}`);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("invalid_offset");
      expect(mocks.getConsumptionHistory).not.toHaveBeenCalled();
    }
  );

  it("returns history with validated filters and authenticated account ID", async () => {
    const history = {
      month: "2026-10",
      items: [],
      pagination: {
        total: 0,
        limit: 10,
        offset: 5,
        hasMore: false
      }
    };

    mocks.getConsumptionHistory.mockResolvedValueOnce(history);

    const response = await get(
      "/?month=2026-10&userId=7&status=accepted&limit=10&offset=5"
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(history);
    expect(mocks.getConsumptionHistory).toHaveBeenCalledWith({
      accountId: "5",
      userId: "7",
      status: "accepted",
      month: "2026-10",
      limit: 10,
      offset: 5
    });
  });

  it("uses default pagination when filters are omitted", async () => {
    mocks.getConsumptionHistory.mockResolvedValueOnce({
      month: "2026-10",
      items: [],
      pagination: {
        total: 0,
        limit: 20,
        offset: 0,
        hasMore: false
      }
    });

    const response = await get("/?month=2026-10");

    expect(response.status).toBe(200);
    expect(mocks.getConsumptionHistory).toHaveBeenCalledWith({
      accountId: "5",
      userId: undefined,
      status: undefined,
      month: "2026-10",
      limit: 20,
      offset: 0
    });
  });

  it("returns 500 when the history service fails", async () => {
    mocks.getConsumptionHistory.mockRejectedValueOnce(
      new Error("Database failure")
    );

    const response = await get("/?month=2026-10");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_server_error");
  });
});

describe("GET /api/consumption/usage", () => {
  it("rejects an invalid month", async () => {
    const response = await get("/usage?month=2026-00");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_month");
    expect(mocks.getMonthlyUsage).not.toHaveBeenCalled();
  });

  it("returns monthly usage for the authenticated account", async () => {
    const usage = {
      month: "2026-10",
      account: { id: "5", remaining: "80" },
      users: []
    };

    mocks.getMonthlyUsage.mockResolvedValueOnce(usage);

    const response = await get("/usage?month=2026-10");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ usage });
    expect(mocks.getMonthlyUsage).toHaveBeenCalledWith("5", "2026-10");
  });

  it("returns 404 when the account is not found", async () => {
    mocks.getMonthlyUsage.mockRejectedValueOnce(
      new Error("ACCOUNT_NOT_FOUND")
    );

    const response = await get("/usage?month=2026-10");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("account_not_found");
  });

  it("returns 500 for unexpected usage errors", async () => {
    mocks.getMonthlyUsage.mockRejectedValueOnce(
      new Error("Unexpected failure")
    );

    const response = await get("/usage?month=2026-10");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_server_error");
  });
});

describe("POST /api/consumption", () => {
  it.each([
    [{ userId: 0, requestId: "req-1", units: 1 }, "invalid_user_id"],
    [{ userId: "abc", requestId: "req-1", units: 1 }, "invalid_user_id"],
    [{ userId: "7", requestId: "", units: 1 }, "invalid_request_id"],
    [{ userId: "7", requestId: "req-1", units: 0 }, "invalid_units"],
    [{ userId: "7", requestId: "req-1", units: -1 }, "invalid_units"],
    [{ userId: "7", requestId: "req-1", units: "1.5" }, "invalid_units"]
  ])("rejects invalid input with error %s", async (input, error) => {
    const response = await post(input);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(error);
    expect(mocks.consumeUnits).not.toHaveBeenCalled();
  });

  it("rejects a request ID longer than 200 characters", async () => {
    const response = await post({
      userId: "7",
      requestId: "x".repeat(201),
      units: 1
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_request_id");
    expect(mocks.consumeUnits).not.toHaveBeenCalled();
  });

  it("records consumption using the authenticated account ID", async () => {
    const consumption = {
      requestId: "req-123",
      units: "5",
      status: "accepted"
    };

    mocks.consumeUnits.mockResolvedValueOnce(consumption);

    const response = await post({
      userId: 7,
      requestId: "  req-123  ",
      units: 5
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ consumption });
    expect(mocks.consumeUnits).toHaveBeenCalledWith({
      accountId: "5",
      userId: "7",
      requestId: "req-123",
      units: "5"
    });
  });

  it.each([
    ["ACCOUNT_NOT_FOUND", 404, "account_not_found"],
    ["USER_NOT_FOUND", 404, "user_not_found"],
    ["IDEMPOTENCY_CONFLICT", 409, "idempotency_conflict"],
    ["Unexpected failure", 500, "internal_server_error"]
  ])(
    "maps service error %s to HTTP %i",
    async (message, expectedStatus, expectedError) => {
      mocks.consumeUnits.mockRejectedValueOnce(new Error(message));

      const response = await post({
        userId: "7",
        requestId: "req-error",
        units: 1
      });
      const body = await response.json();

      expect(response.status).toBe(expectedStatus);
      expect(body.error).toBe(expectedError);
    }
  );
});
