import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
  createAccount: vi.fn(),
  getAccountById: vi.fn(),
  updateAccountPlan: vi.fn(),
  createUser: vi.fn(),
  getUserById: vi.fn(),
  updateUserPlan: vi.fn()
}));

vi.mock("../src/services/accounts.service.js", () => ({
  createAccount: mocks.createAccount,
  getAccountById: mocks.getAccountById,
  updateAccountPlan: mocks.updateAccountPlan
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
import accountsRouter from "../src/routes/accounts.routes.js";
import usersRouter from "../src/routes/users.routes.js";
import {
  updateAccountPlan
} from "../src/services/accounts.service.js";
import {
  getUserById,
  updateUserPlan
} from "../src/services/users.service.js";

const app = express();

app.use(express.json());
app.use("/api/accounts", accountsRouter);
app.use("/api/users", usersRouter);

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

      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
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
});

async function patch(
  path: string,
  body: Record<string, unknown>
) {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": "test-api-key"
    },
    body: JSON.stringify(body)
  });
}

describe("PATCH /api/accounts/:id/plan", () => {
  it("updates the authenticated account plan", async () => {
    const account = {
      id: "5",
      name: "Plan Testing Account",
      planId: "2",
      planName: "Pro",
      createdAt: new Date("2026-10-14T19:30:38.810Z")
    };

    vi.mocked(updateAccountPlan).mockResolvedValueOnce(account);

    const response = await patch("/api/accounts/5/plan", {
      planId: 2
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.account.planName).toBe("Pro");
    expect(body.message).toBe("Account plan updated successfully");
    expect(updateAccountPlan).toHaveBeenCalledWith("5", "2");
  });

  it("rejects an attempt to change another account's plan", async () => {
    const response = await patch("/api/accounts/6/plan", {
      planId: 2
    });

    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("account_not_found");
    expect(updateAccountPlan).not.toHaveBeenCalled();
  });

  it("rejects an invalid account ID", async () => {
    const response = await patch("/api/accounts/0/plan", {
      planId: 2
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_account_id");
    expect(updateAccountPlan).not.toHaveBeenCalled();
  });

  it("rejects an invalid plan ID", async () => {
    const response = await patch("/api/accounts/5/plan", {
      planId: 0
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_plan_id");
    expect(updateAccountPlan).not.toHaveBeenCalled();
  });

  it("rejects a plan that is unavailable to the account", async () => {
    vi.mocked(updateAccountPlan).mockResolvedValueOnce(null);

    const response = await patch("/api/accounts/5/plan", {
      planId: 999
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_account_plan");
  });
});

describe("PATCH /api/users/:id/plan", () => {
  it("updates a user plan within the authenticated account", async () => {
    const user = {
      id: "5",
      accountId: "5",
      externalId: "test-user-001",
      planId: "4",
      planName: "Premium",
      createdAt: new Date("2026-10-14T19:33:58.561Z")
    };

    vi.mocked(updateUserPlan).mockResolvedValueOnce(user);

    const response = await patch("/api/users/5/plan", {
      planId: 4
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.planName).toBe("Premium");
    expect(body.message).toBe("User plan updated successfully");
    expect(updateUserPlan).toHaveBeenCalledWith("5", "5", "4");
  });

  it("rejects an invalid user ID", async () => {
    const response = await patch("/api/users/0/plan", {
      planId: 4
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_user_id");
    expect(updateUserPlan).not.toHaveBeenCalled();
  });

  it("rejects an invalid user plan ID", async () => {
    const response = await patch("/api/users/5/plan", {
      planId: -1
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_plan_id");
    expect(updateUserPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not exist in the account", async () => {
    vi.mocked(updateUserPlan).mockResolvedValueOnce(null);
    vi.mocked(getUserById).mockResolvedValueOnce(null);

    const response = await patch("/api/users/999/plan", {
      planId: 4
    });

    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("user_not_found");
    expect(getUserById).toHaveBeenCalledWith("5", "999");
  });

  it("rejects a plan that is unavailable to the user", async () => {
    vi.mocked(updateUserPlan).mockResolvedValueOnce(null);

    vi.mocked(getUserById).mockResolvedValueOnce({
      id: "5",
      accountId: "5",
      externalId: "test-user-001",
      planId: "3",
      planName: "Basic",
      createdAt: new Date("2026-10-14T19:33:58.561Z")
    });

    const response = await patch("/api/users/5/plan", {
      planId: 999
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_user_plan");
  });
});
