import type { NextFunction, Request, Response } from "express";
import { createServer, type Server } from "node:http";
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
  createUser: vi.fn(),
  getUserById: vi.fn(),
  updateUserPlan: vi.fn()
}));

vi.mock("../src/services/users.service.js", () => ({
  createUser: mocks.createUser,
  getUserById: mocks.getUserById,
  updateUserPlan: mocks.updateUserPlan
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
import usersRouter from "../src/routes/users.routes.js";

const app = express();
app.use(express.json());
app.use("/api/users", usersRouter);

let server: Server;
let baseUrl = "";

const sampleUser = {
  id: "7",
  accountId: "5",
  externalId: "customer-123",
  planId: "2",
  createdAt: "2026-10-14T10:00:00.000Z"
};

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
  return fetch(`${baseUrl}/api/users${path}`);
}

async function post(body?: unknown) {
  return fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function patch(path: string, body?: unknown) {
  return fetch(`${baseUrl}/api/users${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

describe("POST /api/users", () => {
  it("creates a user and returns it", async () => {
    mocks.createUser.mockResolvedValueOnce(sampleUser);

    const response = await post({
      externalId: "customer-123",
      planId: 2
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ user: sampleUser });
    expect(mocks.createUser).toHaveBeenCalledWith(
      "5",
      "customer-123",
      "2"
    );
  });

  it("trims the external ID and accepts a string plan ID", async () => {
    mocks.createUser.mockResolvedValueOnce(sampleUser);

    const response = await post({
      externalId: "  customer-123  ",
      planId: "2"
    });

    expect(response.status).toBe(201);
    expect(mocks.createUser).toHaveBeenCalledWith(
      "5",
      "customer-123",
      "2"
    );
  });

  it.each([
    ["missing body", undefined],
    ["missing external ID", { planId: 2 }],
    ["numeric external ID", { externalId: 123, planId: 2 }],
    ["empty external ID", { externalId: "", planId: 2 }],
    ["whitespace external ID", { externalId: "   ", planId: 2 }],
    [
      "external ID longer than 200 characters",
      { externalId: "x".repeat(201), planId: 2 }
    ]
  ])("rejects invalid external ID: %s", async (_label, input) => {
    const response = await post(input);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_external_id");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("accepts an external ID of exactly 200 characters", async () => {
    mocks.createUser.mockResolvedValueOnce(sampleUser);

    const externalId = "x".repeat(200);
    const response = await post({ externalId, planId: 2 });

    expect(response.status).toBe(201);
    expect(mocks.createUser).toHaveBeenCalledWith(
      "5",
      externalId,
      "2"
    );
  });

  it.each([
    ["missing plan ID", { externalId: "customer-123" }],
    ["null plan ID", { externalId: "customer-123", planId: null }],
    ["object plan ID", { externalId: "customer-123", planId: {} }],
    ["zero", { externalId: "customer-123", planId: 0 }],
    ["negative ID", { externalId: "customer-123", planId: -1 }],
    ["decimal ID", { externalId: "customer-123", planId: 1.5 }],
    ["non-numeric ID", { externalId: "customer-123", planId: "abc" }],
    ["leading zero", { externalId: "customer-123", planId: "02" }],
    ["empty ID", { externalId: "customer-123", planId: "" }]
  ])("rejects invalid plan ID: %s", async (_label, input) => {
    const response = await post(input);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_plan_id");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("returns 404 when the account does not exist", async () => {
    mocks.createUser.mockRejectedValueOnce(
      new Error("ACCOUNT_NOT_FOUND")
    );

    const response = await post({
      externalId: "customer-123",
      planId: 2
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("account_not_found");
  });

  it("returns 400 when the user plan does not exist", async () => {
    mocks.createUser.mockRejectedValueOnce(
      new Error("USER_PLAN_NOT_FOUND")
    );

    const response = await post({
      externalId: "customer-123",
      planId: 2
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_user_plan");
  });

  it("returns 409 when the external ID already exists", async () => {
    mocks.createUser.mockRejectedValueOnce({ code: "23505" });

    const response = await post({
      externalId: "customer-123",
      planId: 2
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("duplicate_external_id");
  });

  it("returns 500 when user creation fails unexpectedly", async () => {
    mocks.createUser.mockRejectedValueOnce(
      new Error("Database failure")
    );

    const response = await post({
      externalId: "customer-123",
      planId: 2
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_server_error");
  });

  it("handles non-Error values thrown by the service", async () => {
    mocks.createUser.mockRejectedValueOnce("unexpected failure");

    const response = await post({
      externalId: "customer-123",
      planId: 2
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_server_error");
  });
});

describe("GET /api/users/:id", () => {
  it("returns the requested user", async () => {
    mocks.getUserById.mockResolvedValueOnce(sampleUser);

    const response = await get("/7");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ user: sampleUser });
    expect(mocks.getUserById).toHaveBeenCalledWith("5", "7");
  });

  it.each(["abc", "0", "-1", "01", "1.5"])(
    "rejects invalid user ID %s",
    async (id) => {
      const response = await get(`/${encodeURIComponent(id)}`);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("invalid_user_id");
      expect(mocks.getUserById).not.toHaveBeenCalled();
    }
  );

  it("returns 404 when the user does not exist", async () => {
    mocks.getUserById.mockResolvedValueOnce(null);

    const response = await get("/7");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("user_not_found");
  });

  it("returns 500 when fetching the user fails", async () => {
    mocks.getUserById.mockRejectedValueOnce(
      new Error("Database failure")
    );

    const response = await get("/7");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_server_error");
  });

  it("handles non-Error values thrown while fetching a user", async () => {
    mocks.getUserById.mockRejectedValueOnce("unexpected failure");

    const response = await get("/7");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_server_error");
  });
});

describe("PATCH /api/users/:id/plan", () => {
  it("updates the user plan successfully", async () => {
    const updatedUser = { ...sampleUser, planId: "3" };
    mocks.updateUserPlan.mockResolvedValueOnce(updatedUser);

    const response = await patch("/7/plan", { planId: 3 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      user: updatedUser,
      message: "User plan updated successfully"
    });
    expect(mocks.updateUserPlan).toHaveBeenCalledWith("5", "7", "3");
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "01", "1.5"])(
    "rejects invalid user ID %s",
    async (id) => {
      const response = await patch(`/${id}/plan`, { planId: 2 });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("invalid_user_id");
      expect(mocks.updateUserPlan).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["missing plan ID", undefined],
    ["null plan ID", null],
    ["object plan ID", {}],
    ["zero", 0],
    ["negative ID", -1],
    ["decimal ID", 1.5],
    ["non-numeric ID", "abc"],
    ["leading zero", "02"],
    ["empty ID", ""]
  ])("rejects invalid plan ID: %s", async (_label, planId) => {
    const response = await patch("/7/plan", { planId });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_plan_id");
    expect(mocks.updateUserPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not exist", async () => {
    mocks.updateUserPlan.mockResolvedValueOnce(null);
    mocks.getUserById.mockResolvedValueOnce(null);

    const response = await patch("/7/plan", { planId: 2 });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("user_not_found");
    expect(mocks.getUserById).toHaveBeenCalledWith("5", "7");
  });

  it("returns 400 when the plan is unavailable to the user", async () => {
    mocks.updateUserPlan.mockResolvedValueOnce(null);
    mocks.getUserById.mockResolvedValueOnce(sampleUser);

    const response = await patch("/7/plan", { planId: 999 });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_user_plan");
  });

  it("returns 500 when updating the user plan fails", async () => {
    mocks.updateUserPlan.mockRejectedValueOnce(
      new Error("Database failure")
    );

    const response = await patch("/7/plan", { planId: 2 });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_server_error");
  });

  it("handles non-Error values thrown while updating the plan", async () => {
    mocks.updateUserPlan.mockRejectedValueOnce("unexpected failure");

    const response = await patch("/7/plan", { planId: 2 });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_server_error");
  });
});