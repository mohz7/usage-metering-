
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn()
}));

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: queryMock
  }
}));

import {
  getAllPlans,
  getPlanById,
  createCustomPlan,
  updateCustomPlan,
  deleteCustomPlan,
  type Plan
} from "../src/services/plans.service.js";

const samplePlan: Plan = {
  id: "10",
  name: "Custom Plan",
  scope: "account",
  isPredefined: false,
  ownerAccountId: "5",
  monthlyAllowance: "1000",
  maxUnitsPerRequest: "100",
  createdAt: new Date("2026-10-14T10:00:00.000Z")
};

const newPlanInput = {
  name: "Custom Plan",
  scope: "account" as const,
  monthlyAllowance: "1000",
  maxUnitsPerRequest: "100"
};

const updatePlanInput = {
  name: "Updated Plan",
  monthlyAllowance: "2000",
  maxUnitsPerRequest: "200"
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAllPlans", () => {
  it("returns plans visible to the account", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [samplePlan]
    });

    const result = await getAllPlans("5");

    expect(result).toEqual([samplePlan]);
    expect(queryMock).toHaveBeenCalledOnce();

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("is_predefined = TRUE");
    expect(sql).toContain("owner_account_id = $1");
    expect(sql).toContain("ORDER BY scope ASC");
    expect(values).toEqual(["5"]);
  });

  it("returns an empty array when no plans are found", async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const result = await getAllPlans("5");

    expect(result).toEqual([]);
  });

  it("propagates database errors", async () => {
    const error = new Error("Database unavailable");
    queryMock.mockRejectedValueOnce(error);

    await expect(getAllPlans("5")).rejects.toThrow(
      "Database unavailable"
    );
  });
});

describe("getPlanById", () => {
  it("returns a plan accessible to the account", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [samplePlan]
    });

    const result = await getPlanById("10", "5");

    expect(result).toEqual(samplePlan);

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("WHERE id = $1");
    expect(sql).toContain("is_predefined = TRUE");
    expect(sql).toContain("owner_account_id = $2");
    expect(values).toEqual(["10", "5"]);
  });

  it("returns null when the plan does not exist", async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const result = await getPlanById("999", "5");

    expect(result).toBeNull();
  });

  it("returns null when the plan is not accessible", async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const result = await getPlanById("10", "other-account");

    expect(result).toBeNull();

    const [, values] = queryMock.mock.calls[0];

    expect(values).toEqual(["10", "other-account"]);
  });

  it("propagates database errors", async () => {
    queryMock.mockRejectedValueOnce(new Error("Query failed"));

    await expect(getPlanById("10", "5")).rejects.toThrow(
      "Query failed"
    );
  });
});

describe("createCustomPlan", () => {
  it("creates a custom plan and returns it", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [samplePlan]
    });

    const result = await createCustomPlan("5", newPlanInput);

    expect(result).toEqual(samplePlan);

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("INSERT INTO plans");
    expect(sql).toContain("is_predefined");
    expect(sql).toContain("RETURNING");
    expect(values).toEqual([
      "Custom Plan",
      "account",
      "5",
      "1000",
      "100"
    ]);
  });

  it("throws when the database returns no created plan", async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      createCustomPlan("5", newPlanInput)
    ).rejects.toThrow("PLAN_CREATION_FAILED");
  });

  it("propagates database errors", async () => {
    queryMock.mockRejectedValueOnce(
      new Error("Insert failed")
    );

    await expect(
      createCustomPlan("5", newPlanInput)
    ).rejects.toThrow("Insert failed");
  });
});

describe("updateCustomPlan", () => {
  it("updates a custom plan owned by the account", async () => {
    const updatedPlan = {
      ...samplePlan,
      name: "Updated Plan",
      monthlyAllowance: "2000",
      maxUnitsPerRequest: "200"
    };

    queryMock.mockResolvedValueOnce({
      rows: [updatedPlan]
    });

    const result = await updateCustomPlan(
      "5",
      "10",
      updatePlanInput
    );

    expect(result).toEqual(updatedPlan);

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("UPDATE plans");
    expect(sql).toContain("owner_account_id = $2");
    expect(sql).toContain("is_predefined = FALSE");
    expect(values).toEqual([
      "10",
      "5",
      "Updated Plan",
      "2000",
      "200"
    ]);
  });

  it("returns null when no custom plan can be updated", async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const result = await updateCustomPlan(
      "5",
      "999",
      updatePlanInput
    );

    expect(result).toBeNull();
  });

  it("propagates database errors", async () => {
    queryMock.mockRejectedValueOnce(
      new Error("Update failed")
    );

    await expect(
      updateCustomPlan("5", "10", updatePlanInput)
    ).rejects.toThrow("Update failed");
  });
});

describe("deleteCustomPlan", () => {
  it("returns true when a custom plan is deleted", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "10" }],
      rowCount: 1
    });

    const result = await deleteCustomPlan("5", "10");

    expect(result).toBe(true);

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("DELETE FROM plans");
    expect(sql).toContain("owner_account_id = $2");
    expect(sql).toContain("is_predefined = FALSE");
    expect(values).toEqual(["10", "5"]);
  });

  it("returns false when no plan is deleted", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    });

    const result = await deleteCustomPlan("5", "999");

    expect(result).toBe(false);
  });

  it("returns false when rowCount is null", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: null
    });

    const result = await deleteCustomPlan("5", "10");

    expect(result).toBe(false);
  });

  it("returns true when rowCount is greater than zero", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: 2
    });

    const result = await deleteCustomPlan("5", "10");

    expect(result).toBe(true);
  });

  it("propagates database errors", async () => {
    queryMock.mockRejectedValueOnce(
      new Error("Delete failed")
    );

    await expect(
      deleteCustomPlan("5", "10")
    ).rejects.toThrow("Delete failed");
  });
});
