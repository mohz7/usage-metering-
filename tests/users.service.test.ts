
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
  createUser,
  getUserById,
  updateUserPlan,
  type User
} from "../src/services/users.service.js";

const sampleUser: User = {
  id: "20",
  accountId: "5",
  externalId: "external-user-123",
  planId: "10",
  planName: "Basic User Plan",
  createdAt: new Date("2026-10-14T10:00:00.000Z")
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createUser", () => {
  it("creates a user with a valid user plan", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [sampleUser],
      rowCount: 1
    });

    const result = await createUser("5", "external-user-123", "10");

    expect(result).toEqual(sampleUser);
    expect(queryMock).toHaveBeenCalledOnce();

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("INSERT INTO users");
    expect(sql).toContain("CROSS JOIN plans");
    expect(sql).toContain("p.scope = 'user'");
    expect(sql).toContain("p.is_predefined = TRUE");
    expect(sql).toContain("p.owner_account_id = a.id");
    expect(values).toEqual(["5", "external-user-123", "10"]);
  });

  it("throws ACCOUNT_NOT_FOUND when the account does not exist", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

    await expect(
      createUser("999", "external-user-123", "10")
    ).rejects.toThrow("ACCOUNT_NOT_FOUND");

    expect(queryMock).toHaveBeenCalledTimes(2);

    expect(queryMock.mock.calls[1][0]).toContain(
      "SELECT 1 FROM accounts WHERE id = $1"
    );
    expect(queryMock.mock.calls[1][1]).toEqual(["999"]);
  });

  it("throws USER_PLAN_NOT_FOUND when the account exists but the plan is unavailable", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      })
      .mockResolvedValueOnce({
        rows: [{ "?column?": 1 }],
        rowCount: 1
      });

    await expect(
      createUser("5", "external-user-123", "999")
    ).rejects.toThrow("USER_PLAN_NOT_FOUND");

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][1]).toEqual(["5"]);
  });

  it("propagates a database error from the insert query", async () => {
    queryMock.mockRejectedValueOnce(new Error("Insert failed"));

    await expect(
      createUser("5", "external-user-123", "10")
    ).rejects.toThrow("Insert failed");

    expect(queryMock).toHaveBeenCalledOnce();
  });

  it("propagates a database error when checking the account", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      })
      .mockRejectedValueOnce(new Error("Account lookup failed"));

    await expect(
      createUser("5", "external-user-123", "10")
    ).rejects.toThrow("Account lookup failed");

    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});

describe("getUserById", () => {
  it("returns a user belonging to the requested account", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [sampleUser],
      rowCount: 1
    });

    const result = await getUserById("5", "20");

    expect(result).toEqual(sampleUser);

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("FROM users u");
    expect(sql).toContain("JOIN plans p ON p.id = u.plan_id");
    expect(sql).toContain("WHERE u.account_id = $1");
    expect(sql).toContain("AND u.id = $2");
    expect(sql).toContain("p.is_predefined = TRUE");
    expect(values).toEqual(["5", "20"]);
  });

  it("returns null when the user does not exist", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    });

    const result = await getUserById("5", "999");

    expect(result).toBeNull();
  });

  it("returns null when the user belongs to another account", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    });

    const result = await getUserById("999", "20");

    expect(result).toBeNull();
    expect(queryMock.mock.calls[0][1]).toEqual(["999", "20"]);
  });

  it("propagates database errors", async () => {
    queryMock.mockRejectedValueOnce(new Error("User lookup failed"));

    await expect(
      getUserById("5", "20")
    ).rejects.toThrow("User lookup failed");
  });
});

describe("updateUserPlan", () => {
  it("updates the user to an available user plan", async () => {
    const updatedUser = {
      ...sampleUser,
      planId: "11",
      planName: "Premium User Plan"
    };

    queryMock.mockResolvedValueOnce({
      rows: [updatedUser],
      rowCount: 1
    });

    const result = await updateUserPlan("5", "20", "11");

    expect(result).toEqual(updatedUser);

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("UPDATE users AS u");
    expect(sql).toContain("FROM plans AS p");
    expect(sql).toContain("p.scope = 'user'");
    expect(sql).toContain("p.is_predefined = TRUE");
    expect(sql).toContain("p.owner_account_id = u.account_id");
    expect(values).toEqual(["5", "20", "11"]);
  });

  it("returns null when the user or target plan is unavailable", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    });

    const result = await updateUserPlan("5", "999", "10");

    expect(result).toBeNull();
  });

  it("returns null when no matching row is updated", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: null
    });

    const result = await updateUserPlan("5", "20", "999");

    expect(result).toBeNull();
  });

  it("propagates database errors", async () => {
    queryMock.mockRejectedValueOnce(new Error("Plan update failed"));

    await expect(
      updateUserPlan("5", "20", "11")
    ).rejects.toThrow("Plan update failed");
  });
});
