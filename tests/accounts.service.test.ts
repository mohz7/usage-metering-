
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, connectMock, clientQueryMock, releaseMock } = vi.hoisted(
  () => ({
    queryMock: vi.fn(),
    connectMock: vi.fn(),
    clientQueryMock: vi.fn(),
    releaseMock: vi.fn()
  })
);

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: queryMock,
    connect: connectMock
  }
}));

import {
  createAccount,
  getAccountById,
  updateAccountPlan,
  type Account
} from "../src/services/accounts.service.js";

const sampleAccount: Account = {
  id: "5",
  name: "Test Account",
  planId: "1",
  planName: "Basic Account Plan",
  createdAt: new Date("2026-10-14T10:00:00.000Z")
};

function mockClient() {
  connectMock.mockResolvedValue({
    query: clientQueryMock,
    release: releaseMock
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient();
});

describe("createAccount", () => {
  it("creates an account and commits the transaction", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{ id: "1", name: "Basic Account Plan" }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [sampleAccount],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const result = await createAccount("Test Account", "1");

    expect(result.account).toEqual(sampleAccount);
    expect(result.apiKey).toMatch(/^um_[a-f0-9]{64}$/);
    expect(result.apiKey).not.toContain("Test Account");

    expect(connectMock).toHaveBeenCalledOnce();
    expect(clientQueryMock).toHaveBeenCalledTimes(4);
    expect(clientQueryMock.mock.calls[0][0]).toBe("BEGIN");
    expect(clientQueryMock.mock.calls[3][0]).toBe("COMMIT");
    expect(releaseMock).toHaveBeenCalledOnce();

    const [insertSql, insertValues] = clientQueryMock.mock.calls[2];

    expect(insertSql).toContain("INSERT INTO accounts");
    expect(insertSql).toContain("api_key_hash");
    expect(insertValues[0]).toBe("Test Account");
    expect(insertValues[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertValues[1]).not.toBe(result.apiKey);
    expect(insertValues[2]).toBe("1");
  });

  it("throws ACCOUNT_PLAN_NOT_FOUND when the account plan does not exist", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      createAccount("Test Account", "999")
    ).rejects.toThrow("ACCOUNT_PLAN_NOT_FOUND");

    expect(clientQueryMock.mock.calls[0][0]).toBe("BEGIN");
    expect(clientQueryMock.mock.calls[1][0]).toContain("FROM plans");
    expect(clientQueryMock.mock.calls[2][0]).toBe("ROLLBACK");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("throws ACCOUNT_CREATION_FAILED when the insert returns no account", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{ id: "1", name: "Basic Account Plan" }],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      createAccount("Test Account", "1")
    ).rejects.toThrow("ACCOUNT_CREATION_FAILED");

    expect(clientQueryMock.mock.calls[3][0]).toBe("ROLLBACK");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("rolls back and rethrows when the plan query fails", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockRejectedValueOnce(new Error("Plan query failed"))
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      createAccount("Test Account", "1")
    ).rejects.toThrow("Plan query failed");

    expect(clientQueryMock.mock.calls[2][0]).toBe("ROLLBACK");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("rolls back and rethrows when the account insert fails", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{ id: "1", name: "Basic Account Plan" }],
        rowCount: 1
      })
      .mockRejectedValueOnce(new Error("Account insert failed"))
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      createAccount("Test Account", "1")
    ).rejects.toThrow("Account insert failed");

    expect(clientQueryMock.mock.calls[3][0]).toBe("ROLLBACK");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("releases the client even when rollback fails", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockRejectedValueOnce(new Error("Plan query failed"))
      .mockRejectedValueOnce(new Error("Rollback failed"));

    await expect(
      createAccount("Test Account", "1")
    ).rejects.toThrow("Rollback failed");

    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("propagates an error when connecting to the database fails", async () => {
    connectMock.mockRejectedValueOnce(new Error("Connection failed"));

    await expect(
      createAccount("Test Account", "1")
    ).rejects.toThrow("Connection failed");

    expect(clientQueryMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("propagates a commit error after attempting rollback", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{ id: "1", name: "Basic Account Plan" }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [sampleAccount],
        rowCount: 1
      })
      .mockRejectedValueOnce(new Error("Commit failed"))
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      createAccount("Test Account", "1")
    ).rejects.toThrow("Commit failed");

    expect(clientQueryMock.mock.calls[3][0]).toBe("COMMIT");
    expect(clientQueryMock.mock.calls[4][0]).toBe("ROLLBACK");
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});

describe("getAccountById", () => {
  it("returns an account when found", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [sampleAccount],
      rowCount: 1
    });

    const result = await getAccountById("5");

    expect(result).toEqual(sampleAccount);

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("FROM accounts a");
    expect(sql).toContain("JOIN plans p");
    expect(sql).toContain("WHERE a.id = $1");
    expect(values).toEqual(["5"]);
  });

  it("returns null when the account does not exist", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    });

    const result = await getAccountById("999");

    expect(result).toBeNull();
  });

  it("propagates database errors", async () => {
    queryMock.mockRejectedValueOnce(
      new Error("Account lookup failed")
    );

    await expect(
      getAccountById("5")
    ).rejects.toThrow("Account lookup failed");
  });
});

describe("updateAccountPlan", () => {
  it("updates the account to an available account plan", async () => {
    const updatedAccount = {
      ...sampleAccount,
      planId: "2",
      planName: "Premium Account Plan"
    };

    queryMock.mockResolvedValueOnce({
      rows: [updatedAccount],
      rowCount: 1
    });

    const result = await updateAccountPlan("5", "2");

    expect(result).toEqual(updatedAccount);

    const [sql, values] = queryMock.mock.calls[0];

    expect(sql).toContain("UPDATE accounts AS a");
    expect(sql).toContain("FROM plans AS p");
    expect(sql).toContain("p.scope = 'account'");
    expect(sql).toContain("p.is_predefined = TRUE");
    expect(sql).toContain("p.owner_account_id = a.id");
    expect(values).toEqual(["5", "2"]);
  });

  it("returns null when no matching account and plan are found", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    });

    const result = await updateAccountPlan("999", "2");

    expect(result).toBeNull();
  });

  it("propagates database errors", async () => {
    queryMock.mockRejectedValueOnce(
      new Error("Account plan update failed")
    );

    await expect(
      updateAccountPlan("5", "2")
    ).rejects.toThrow("Account plan update failed");
  });
});
