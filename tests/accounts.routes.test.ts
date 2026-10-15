import express from "express";
import type { Server } from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

const {
  createAccountMock,
  getAccountByIdMock,
  updateAccountPlanMock
} = vi.hoisted(() => ({
  createAccountMock: vi.fn(),
  getAccountByIdMock: vi.fn(),
  updateAccountPlanMock: vi.fn()
}));

vi.mock("../src/services/accounts.service.js", () => ({
  createAccount: createAccountMock,
  getAccountById: getAccountByIdMock,
  updateAccountPlan: updateAccountPlanMock
}));

vi.mock("../src/middleware/account-auth.middleware.js", () => ({
  authenticateApiKey: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    res.locals.accountId = req.get("x-account-id") ?? "1";
    next();
  }
}));

import accountsRouter from "../src/routes/accounts.routes.js";

const app = express();
app.use(express.json());
app.use("/accounts", accountsRouter);

let server: Server;
let baseUrl: string;

const sampleAccount = {
  id: "1",
  name: "Test Account",
  planId: "2",
  planName: "Basic Account Plan",
  createdAt: new Date("2026-10-14T10:00:00.000Z")
};

const serializedSampleAccount = {
  ...sampleAccount,
  createdAt: sampleAccount.createdAt.toISOString()
};

async function sendRequest(
  method: string,
  path: string,
  body?: unknown,
  accountId = "1"
) {
  const headers: Record<string, string> = {
    "x-account-id": accountId
  };

  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {})
  });

  const text = await response.text();

  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    data = { rawBody: text };
  }

  return {
    status: response.status,
    data
  };
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      resolve();
    });

    server.once("error", reject);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /accounts", () => {
  it("creates an account and returns its API key", async () => {
    createAccountMock.mockResolvedValueOnce({
      account: sampleAccount,
      apiKey: "um_test_api_key"
    });

    const response = await sendRequest("POST", "/accounts", {
      name: "  Test Account  ",
      planId: 2
    });

    expect(response.status).toBe(201);
    expect(response.data).toEqual({
      account: serializedSampleAccount,
      apiKey: "um_test_api_key",
      message: "Save this API key now. It cannot be retrieved later."
    });

    expect(createAccountMock).toHaveBeenCalledWith(
      "Test Account",
      "2"
    );
  });

  it("accepts a string plan ID", async () => {
    createAccountMock.mockResolvedValueOnce({
      account: sampleAccount,
      apiKey: "um_test_api_key"
    });

    const response = await sendRequest("POST", "/accounts", {
      name: "Test Account",
      planId: "12"
    });

    expect(response.status).toBe(201);
    expect(createAccountMock).toHaveBeenCalledWith(
      "Test Account",
      "12"
    );
  });

  it.each([
    ["missing name", {}],
    ["missing body", undefined],
    ["numeric name", { name: 123, planId: "1" }],
    ["empty name", { name: "", planId: "1" }],
    ["whitespace name", { name: "   ", planId: "1" }],
    ["one-character name", { name: "A", planId: "1" }],
    [
      "name longer than 100 characters",
      { name: "A".repeat(101), planId: "1" }
    ]
  ])("rejects invalid account name: %s", async (_label, body) => {
    const response = await sendRequest("POST", "/accounts", body);

    expect(response.status).toBe(400);
    expect(response.data).toEqual({
      error: "invalid_account_name",
      message: "Account name must be between 2 and 100 characters"
    });
    expect(createAccountMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing plan ID", { name: "Test Account" }],
    ["null plan ID", { name: "Test Account", planId: null }],
    ["object plan ID", { name: "Test Account", planId: {} }],
    ["zero", { name: "Test Account", planId: 0 }],
    ["negative ID", { name: "Test Account", planId: -1 }],
    ["decimal ID", { name: "Test Account", planId: 1.5 }],
    ["non-numeric ID", { name: "Test Account", planId: "abc" }],
    ["leading zero", { name: "Test Account", planId: "01" }],
    ["empty ID", { name: "Test Account", planId: "" }]
  ])("rejects invalid plan ID: %s", async (_label, body) => {
    const response = await sendRequest("POST", "/accounts", body);

    expect(response.status).toBe(400);
    expect(response.data).toEqual({
      error: "invalid_plan_id",
      message: "Plan ID must be a positive integer"
    });
    expect(createAccountMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the selected account plan does not exist", async () => {
    createAccountMock.mockRejectedValueOnce(
      new Error("ACCOUNT_PLAN_NOT_FOUND")
    );

    const response = await sendRequest("POST", "/accounts", {
      name: "Test Account",
      planId: "999"
    });

    expect(response.status).toBe(400);
    expect(response.data).toEqual({
      error: "invalid_account_plan",
      message: "The selected plan does not exist or is not an account plan"
    });
  });

  it("returns 500 when account creation fails unexpectedly", async () => {
    createAccountMock.mockRejectedValueOnce(
      new Error("Database unavailable")
    );

    const response = await sendRequest("POST", "/accounts", {
      name: "Test Account",
      planId: "1"
    });

    expect(response.status).toBe(500);
    expect(response.data).toEqual({
      error: "internal_server_error",
      message: "Failed to create account"
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("handles non-Error values thrown by the service", async () => {
    createAccountMock.mockRejectedValueOnce("unexpected failure");

    const response = await sendRequest("POST", "/accounts", {
      name: "Test Account",
      planId: "1"
    });

    expect(response.status).toBe(500);
    expect(response.data.error).toBe("internal_server_error");
  });
});

describe("GET /accounts/:id", () => {
  it("returns the authenticated account", async () => {
    getAccountByIdMock.mockResolvedValueOnce(sampleAccount);

    const response = await sendRequest("GET", "/accounts/1");

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      account: serializedSampleAccount
    });
    expect(getAccountByIdMock).toHaveBeenCalledWith("1");
  });

  it("rejects an account ID containing letters", async () => {
    const response = await sendRequest("GET", "/accounts/abc");

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("invalid_account_id");
    expect(getAccountByIdMock).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "01", "1.5"])(
    "rejects invalid account ID %s",
    async (id) => {
      const response = await sendRequest("GET", `/accounts/${id}`);

      expect(response.status).toBe(400);
      expect(response.data.error).toBe("invalid_account_id");
      expect(getAccountByIdMock).not.toHaveBeenCalled();
    }
  );

  it("returns 404 when requesting another account", async () => {
    const response = await sendRequest("GET", "/accounts/2", undefined, "1");

    expect(response.status).toBe(404);
    expect(response.data).toEqual({
      error: "account_not_found",
      message: "Account was not found"
    });
    expect(getAccountByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the account does not exist", async () => {
    getAccountByIdMock.mockResolvedValueOnce(null);

    const response = await sendRequest("GET", "/accounts/1");

    expect(response.status).toBe(404);
    expect(response.data.error).toBe("account_not_found");
  });

  it("returns 500 when fetching the account fails", async () => {
    getAccountByIdMock.mockRejectedValueOnce(
      new Error("Database unavailable")
    );

    const response = await sendRequest("GET", "/accounts/1");

    expect(response.status).toBe(500);
    expect(response.data).toEqual({
      error: "internal_server_error",
      message: "Failed to fetch account"
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("PATCH /accounts/:id/plan", () => {
  it("updates the authenticated account plan", async () => {
    const updatedAccount = {
      ...sampleAccount,
      planId: "3",
      planName: "Premium Account Plan"
    };

    updateAccountPlanMock.mockResolvedValueOnce(updatedAccount);

    const response = await sendRequest(
      "PATCH",
      "/accounts/1/plan",
      { planId: 3 }
    );

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      account: {
        ...updatedAccount,
        createdAt: updatedAccount.createdAt.toISOString()
      },
      message: "Account plan updated successfully"
    });
    expect(updateAccountPlanMock).toHaveBeenCalledWith("1", "3");
  });

  it("rejects an invalid account ID", async () => {
    const response = await sendRequest(
      "PATCH",
      "/accounts/abc/plan",
      { planId: "2" }
    );

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("invalid_account_id");
    expect(updateAccountPlanMock).not.toHaveBeenCalled();
  });

  it("returns 404 when changing another account's plan", async () => {
    const response = await sendRequest(
      "PATCH",
      "/accounts/2/plan",
      { planId: "3" }
    );

    expect(response.status).toBe(404);
    expect(response.data).toEqual({
      error: "account_not_found",
      message: "Account was not found"
    });
    expect(updateAccountPlanMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing plan ID", {}],
    ["null plan ID", { planId: null }],
    ["zero", { planId: 0 }],
    ["negative ID", { planId: -2 }],
    ["decimal ID", { planId: 1.2 }],
    ["non-numeric ID", { planId: "abc" }],
    ["leading zero", { planId: "02" }]
  ])("rejects invalid plan ID: %s", async (_label, body) => {
    const response = await sendRequest(
      "PATCH",
      "/accounts/1/plan",
      body
    );

    expect(response.status).toBe(400);
    expect(response.data).toEqual({
      error: "invalid_plan_id",
      message: "Plan ID must be a positive integer"
    });
    expect(updateAccountPlanMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the plan is unavailable to the account", async () => {
    updateAccountPlanMock.mockResolvedValueOnce(null);

    const response = await sendRequest(
      "PATCH",
      "/accounts/1/plan",
      { planId: "999" }
    );

    expect(response.status).toBe(400);
    expect(response.data).toEqual({
      error: "invalid_account_plan",
      message: "The selected plan does not exist or is not available to this account"
    });
  });

  it("returns 500 when updating the plan fails", async () => {
    updateAccountPlanMock.mockRejectedValueOnce(
      new Error("Database unavailable")
    );

    const response = await sendRequest(
      "PATCH",
      "/accounts/1/plan",
      { planId: "2" }
    );

    expect(response.status).toBe(500);
    expect(response.data).toEqual({
      error: "internal_server_error",
      message: "Failed to update account plan"
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("handles non-Error values thrown while updating the plan", async () => {
    updateAccountPlanMock.mockRejectedValueOnce("unexpected failure");

    const response = await sendRequest(
      "PATCH",
      "/accounts/1/plan",
      { planId: "2" }
    );

    expect(response.status).toBe(500);
    expect(response.data.error).toBe("internal_server_error");
  });
});