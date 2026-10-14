import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn()
}));

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: mockQuery
  }
}));

import { updateAccountPlan } from "../src/services/accounts.service.js";
import { updateUserPlan } from "../src/services/users.service.js";

describe("updateAccountPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the account to an available account plan", async () => {
    const account = {
      id: "5",
      name: "Plan Testing Account",
      planId: "2",
      planName: "Pro",
      createdAt: new Date("2026-10-14T19:30:38.810Z")
    };

    mockQuery.mockResolvedValue({
      rows: [account],
      rowCount: 1
    });

    const result = await updateAccountPlan("5", "2");

    expect(result).toEqual(account);
    expect(mockQuery).toHaveBeenCalledOnce();

    const [sql, values] = mockQuery.mock.calls[0];

    expect(sql).toContain("p.scope = 'account'");
    expect(sql).toContain("p.owner_account_id = a.id");
    expect(values).toEqual(["5", "2"]);
  });

  it("returns null when the account plan is unavailable", async () => {
    mockQuery.mockResolvedValue({
      rows: [],
      rowCount: 0
    });

    const result = await updateAccountPlan("5", "999");

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledOnce();
  });
});

describe("updateUserPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a user's plan within the authenticated account", async () => {
    const user = {
      id: "5",
      accountId: "5",
      externalId: "test-user-001",
      planId: "4",
      planName: "Premium",
      createdAt: new Date("2026-10-14T19:33:58.561Z")
    };

    mockQuery.mockResolvedValue({
      rows: [user],
      rowCount: 1
    });

    const result = await updateUserPlan("5", "5", "4");

    expect(result).toEqual(user);
    expect(mockQuery).toHaveBeenCalledOnce();

    const [sql, values] = mockQuery.mock.calls[0];

    expect(sql).toContain("u.account_id = $1");
    expect(sql).toContain("p.scope = 'user'");
    expect(sql).toContain("p.owner_account_id = u.account_id");
    expect(values).toEqual(["5", "5", "4"]);
  });

  it("returns null when the user plan is unavailable", async () => {
    mockQuery.mockResolvedValue({
      rows: [],
      rowCount: 0
    });

    const result = await updateUserPlan("5", "5", "999");

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledOnce();
  });
});
