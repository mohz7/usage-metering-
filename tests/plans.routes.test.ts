
import type { NextFunction, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
  getAllPlans: vi.fn(),
  getPlanById: vi.fn(),
  createCustomPlan: vi.fn(),
  updateCustomPlan: vi.fn(),
  deleteCustomPlan: vi.fn()
}));

vi.mock("../src/services/plans.service.js", () => ({
  getAllPlans: mocks.getAllPlans,
  getPlanById: mocks.getPlanById,
  createCustomPlan: mocks.createCustomPlan,
  updateCustomPlan: mocks.updateCustomPlan,
  deleteCustomPlan: mocks.deleteCustomPlan
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
import plansRouter from "../src/routes/plans.routes.js";
import {
  createCustomPlan,
  deleteCustomPlan,
  getAllPlans,
  getPlanById,
  updateCustomPlan
} from "../src/services/plans.service.js";

const app = express();
app.use(express.json());
app.use("/api/plans", plansRouter);

let server: Server;
let baseUrl = "";

const samplePlan = {
  id: "10",
  name: "Custom Plan",
  scope: "account" as const,
  isPredefined: false,
  ownerAccountId: "5",
  monthlyAllowance: "1000",
  maxUnitsPerRequest: "100",
  createdAt: new Date("2026-10-14T10:00:00.000Z")
};

const validBody = {
  name: "  Custom Plan  ",
  scope: "account",
  monthlyAllowance: "1000",
  maxUnitsPerRequest: "100"
};

const validUpdateBody = {
  name: "  Updated Plan  ",
  monthlyAllowance: "2000",
  maxUnitsPerRequest: "200"
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

async function request(
  path: string,
  method = "GET",
  body?: unknown
) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": "test-api-key"
    },
    ...(body === undefined
      ? {}
      : {
          body: body === null ? "{}" : JSON.stringify(body)
        })
  });
}

function postgresError(code: string) {
  return Object.assign(new Error("Database error"), { code });
}

describe("GET /api/plans", () => {
  it("returns the plans and their count", async () => {
    vi.mocked(getAllPlans).mockResolvedValueOnce([
      samplePlan,
      { ...samplePlan, id: "11", name: "Another Plan" }
    ]);

    const response = await request("/api/plans");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.plans).toHaveLength(2);
    expect(getAllPlans).toHaveBeenCalledWith("5");
  });

  it("returns an empty list when no plans exist", async () => {
    vi.mocked(getAllPlans).mockResolvedValueOnce([]);

    const response = await request("/api/plans");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ plans: [], count: 0 });
  });

  it("returns 500 when fetching plans fails", async () => {
    vi.mocked(getAllPlans).mockRejectedValueOnce(
      new Error("Database unavailable")
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await request("/api/plans");
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("internal_server_error");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("POST /api/plans", () => {
  it("creates a custom plan and trims its name", async () => {
    vi.mocked(createCustomPlan).mockResolvedValueOnce(samplePlan);

    const response = await request("/api/plans", "POST", validBody);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.plan.id).toBe("10");
    expect(createCustomPlan).toHaveBeenCalledWith("5", {
      name: "Custom Plan",
      scope: "account",
      monthlyAllowance: "1000",
      maxUnitsPerRequest: "100"
    });
  });

  it("accepts numeric integer values", async () => {
    vi.mocked(createCustomPlan).mockResolvedValueOnce(samplePlan);

    const response = await request("/api/plans", "POST", {
      name: "Numeric Plan",
      scope: "user",
      monthlyAllowance: 0,
      maxUnitsPerRequest: 1
    });

    expect(response.status).toBe(201);
    expect(createCustomPlan).toHaveBeenCalledWith("5", {
      name: "Numeric Plan",
      scope: "user",
      monthlyAllowance: "0",
      maxUnitsPerRequest: "1"
    });
  });

  it.each([
    ["empty object", {}],
    ["array body", []],
    ["missing name", { scope: "account", monthlyAllowance: "10", maxUnitsPerRequest: "1" }],
    ["name too short", { ...validBody, name: " " }],
    ["name too long", { ...validBody, name: "x".repeat(101) }],
    ["invalid scope", { ...validBody, scope: "global" }],
    ["missing scope", { name: "Valid Name", monthlyAllowance: "10", maxUnitsPerRequest: "1" }],
    ["negative allowance", { ...validBody, monthlyAllowance: "-1" }],
    ["decimal allowance", { ...validBody, monthlyAllowance: "1.5" }],
    ["leading zero allowance", { ...validBody, monthlyAllowance: "01" }],
    ["invalid allowance text", { ...validBody, monthlyAllowance: "abc" }],
    ["unsafe numeric allowance", { ...validBody, monthlyAllowance: Number.MAX_SAFE_INTEGER + 1 }],
    ["allowance above bigint", { ...validBody, monthlyAllowance: "9223372036854775808" }],
    ["negative maximum", { ...validBody, maxUnitsPerRequest: "-1" }],
    ["zero maximum", { ...validBody, maxUnitsPerRequest: "0" }],
    ["decimal maximum", { ...validBody, maxUnitsPerRequest: "1.5" }],
    ["missing maximum", { name: "Valid Name", scope: "account", monthlyAllowance: "10" }],
    ["maximum above bigint", { ...validBody, maxUnitsPerRequest: "9223372036854775808" }]
  ])("rejects invalid input: %s", async (_label, body) => {
    const response = await request("/api/plans", "POST", body);
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.error).toBe("invalid_plan");
    expect(createCustomPlan).not.toHaveBeenCalled();
  });

  it("returns 409 when the plan name and scope already exist", async () => {
    vi.mocked(createCustomPlan).mockRejectedValueOnce(postgresError("23505"));

    const response = await request("/api/plans", "POST", validBody);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("duplicate_plan");
  });

  it("returns 500 for an unexpected creation error", async () => {
    vi.mocked(createCustomPlan).mockRejectedValueOnce(new Error("Unexpected"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await request("/api/plans", "POST", validBody);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("internal_server_error");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("GET /api/plans/:id", () => {
  it("returns a plan by ID", async () => {
    vi.mocked(getPlanById).mockResolvedValueOnce(samplePlan);

    const response = await request("/api/plans/10");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.id).toBe("10");
    expect(getPlanById).toHaveBeenCalledWith("10", "5");
  });

  it("returns 404 when the plan does not exist or is not accessible", async () => {
    vi.mocked(getPlanById).mockResolvedValueOnce(null);

    const response = await request("/api/plans/999");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("plan_not_found");
  });

  it.each(["0", "-1", "01", "abc", "1.5"])(
    "rejects invalid plan ID %s",
    async (id) => {
      const response = await request(`/api/plans/${id}`);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("invalid_plan_id");
      expect(getPlanById).not.toHaveBeenCalled();
    }
  );

  it("returns 500 when fetching a plan fails", async () => {
    vi.mocked(getPlanById).mockRejectedValueOnce(new Error("Database error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await request("/api/plans/10");
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("internal_server_error");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("PUT /api/plans/:id", () => {
  it("updates a custom plan", async () => {
    vi.mocked(updateCustomPlan).mockResolvedValueOnce({
      ...samplePlan,
      name: "Updated Plan",
      monthlyAllowance: "2000",
      maxUnitsPerRequest: "200"
    });

    const response = await request(
      "/api/plans/10",
      "PUT",
      validUpdateBody
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.name).toBe("Updated Plan");
    expect(updateCustomPlan).toHaveBeenCalledWith("5", "10", {
      name: "Updated Plan",
      monthlyAllowance: "2000",
      maxUnitsPerRequest: "200"
    });
  });

  it("returns 404 when the custom plan is unavailable", async () => {
    vi.mocked(updateCustomPlan).mockResolvedValueOnce(null);

    const response = await request("/api/plans/10", "PUT", validUpdateBody);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("custom_plan_not_found");
  });

  it("rejects an invalid ID before updating", async () => {
    const response = await request("/api/plans/0", "PUT", validUpdateBody);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_plan_id");
    expect(updateCustomPlan).not.toHaveBeenCalled();
  });

  it.each([
    ["empty object", {}],
    ["name too short", { ...validUpdateBody, name: "x" }],
    ["name too long", { ...validUpdateBody, name: "x".repeat(101) }],
    ["negative allowance", { ...validUpdateBody, monthlyAllowance: "-1" }],
    ["invalid allowance", { ...validUpdateBody, monthlyAllowance: "abc" }],
    ["zero maximum", { ...validUpdateBody, maxUnitsPerRequest: "0" }],
    ["invalid maximum", { ...validUpdateBody, maxUnitsPerRequest: "1.2" }]
  ])("rejects invalid update: %s", async (_label, body) => {
    const response = await request("/api/plans/10", "PUT", body);
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.error).toBe("invalid_plan");
    expect(updateCustomPlan).not.toHaveBeenCalled();
  });

  it("returns 409 when the updated plan duplicates another plan", async () => {
    vi.mocked(updateCustomPlan).mockRejectedValueOnce(postgresError("23505"));

    const response = await request("/api/plans/10", "PUT", validUpdateBody);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("duplicate_plan");
  });

  it("returns 500 for an unexpected update error", async () => {
    vi.mocked(updateCustomPlan).mockRejectedValueOnce(new Error("Unexpected"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await request("/api/plans/10", "PUT", validUpdateBody);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("internal_server_error");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("DELETE /api/plans/:id", () => {
  it("deletes a custom plan", async () => {
    vi.mocked(deleteCustomPlan).mockResolvedValueOnce(true);

    const response = await request("/api/plans/10", "DELETE");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Custom plan deleted successfully");
    expect(deleteCustomPlan).toHaveBeenCalledWith("5", "10");
  });

  it("returns 404 when the plan cannot be deleted because it is unavailable", async () => {
    vi.mocked(deleteCustomPlan).mockResolvedValueOnce(false);

    const response = await request("/api/plans/10", "DELETE");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("custom_plan_not_found");
  });

  it("rejects an invalid ID", async () => {
    const response = await request("/api/plans/0", "DELETE");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_plan_id");
    expect(deleteCustomPlan).not.toHaveBeenCalled();
  });

  it("returns 409 when a plan is still assigned", async () => {
    vi.mocked(deleteCustomPlan).mockRejectedValueOnce(postgresError("23503"));

    const response = await request("/api/plans/10", "DELETE");
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("plan_in_use");
  });

  it("returns 500 for an unexpected deletion error", async () => {
    vi.mocked(deleteCustomPlan).mockRejectedValueOnce(new Error("Unexpected"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await request("/api/plans/10", "DELETE");
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("internal_server_error");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
