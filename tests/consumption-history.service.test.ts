import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn()
}));

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: queryMock,
    on: vi.fn(),
    end: vi.fn()
  }
}));

import {
  getConsumptionHistory,
  getMonthlyUsage
} from "../src/services/consumption-history.service.js";

beforeEach(() => {
  queryMock.mockReset();
});

describe("getConsumptionHistory", () => {
  it("returns paginated history and applies account and month filters", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: "3" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "9",
            accountId: "2",
            userId: "7",
            requestId: "req-9",
            units: "15",
            status: "accepted",
            rejectionReason: null,
            createdAt: new Date("2026-10-12T12:00:00.000Z")
          }
        ]
      });

    const result = await getConsumptionHistory({
      accountId: "2",
      month: "2026-10",
      limit: 1,
      offset: 2
    });

    expect(result).toEqual({
      month: "2026-10",
      items: [
        {
          id: "9",
          accountId: "2",
          userId: "7",
          requestId: "req-9",
          units: "15",
          status: "accepted",
          rejectionReason: null,
          createdAt: new Date("2026-10-12T12:00:00.000Z")
        }
      ],
      pagination: {
        total: 3,
        limit: 1,
        offset: 2,
        hasMore: false
      }
    });

    expect(queryMock).toHaveBeenCalledTimes(2);

    const [countSql, countValues] = queryMock.mock.calls[0] as [
      string,
      unknown[]
    ];

    expect(countSql).toContain("account_id = $1");
    expect(countSql).toContain("created_at >= $2");
    expect(countSql).toContain("created_at < $3");
    expect(countValues).toEqual([
      "2",
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-11-01T00:00:00.000Z")
    ]);

    const [pageSql, pageValues] = queryMock.mock.calls[1] as [
      string,
      unknown[]
    ];

    expect(pageSql).toContain("ORDER BY created_at DESC, id DESC");
    expect(pageSql).toContain("LIMIT $4");
    expect(pageSql).toContain("OFFSET $5");
    expect(pageValues).toEqual([...countValues, 1, 2]);
  });

  it("adds user and status filters with parameterized values", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: [] });

    await getConsumptionHistory({
      accountId: "4",
      userId: "8",
      status: "rejected",
      month: "2026-02",
      limit: 20,
      offset: 0
    });

    const [countSql, countValues] = queryMock.mock.calls[0] as [
      string,
      unknown[]
    ];

    expect(countSql).toContain("user_id = $4");
    expect(countSql).toContain("status = $5");
    expect(countValues).toEqual([
      "4",
      new Date("2026-02-01T00:00:00.000Z"),
      new Date("2026-03-01T00:00:00.000Z"),
      "8",
      "rejected"
    ]);

    const [pageSql, pageValues] = queryMock.mock.calls[1] as [
      string,
      unknown[]
    ];

    expect(pageSql).toContain("LIMIT $6");
    expect(pageSql).toContain("OFFSET $7");
    expect(pageValues).toEqual([...countValues, 20, 0]);
  });

  it("sets hasMore when additional records remain", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: "5" }] })
      .mockResolvedValueOnce({ rows: [{ id: "3" }, { id: "2" }] });

    const result = await getConsumptionHistory({
      accountId: "1",
      month: "2026-01",
      limit: 2,
      offset: 1
    });

    expect(result.pagination).toEqual({
      total: 5,
      limit: 2,
      offset: 1,
      hasMore: true
    });
  });

  it("returns an empty page when the offset is beyond the total", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: "2" }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getConsumptionHistory({
      accountId: "1",
      month: "2026-01",
      limit: 20,
      offset: 10
    });

    expect(result.items).toEqual([]);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.total).toBe(2);
  });
});

describe("getMonthlyUsage", () => {
  it("calculates account and user remaining allowances", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "2",
            planId: "1",
            planName: "Starter",
            monthlyAllowance: "100",
            maxUnitsPerRequest: "20",
            used: "35"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "7",
            externalId: "customer-7",
            planId: "3",
            planName: "Basic",
            monthlyAllowance: "50",
            maxUnitsPerRequest: "10",
            used: "20"
          },
          {
            id: "8",
            externalId: "customer-8",
            planId: "4",
            planName: "Premium",
            monthlyAllowance: "10",
            maxUnitsPerRequest: "5",
            used: "15"
          }
        ]
      });

    const result = await getMonthlyUsage("2", "2026-10");

    expect(result.month).toBe("2026-10");
    expect(result.account).toEqual({
      id: "2",
      planId: "1",
      planName: "Starter",
      monthlyAllowance: "100",
      maxUnitsPerRequest: "20",
      used: "35",
      remaining: "65",
      exceeded: false
    });

    expect(result.users).toEqual([
      {
        id: "7",
        externalId: "customer-7",
        planId: "3",
        planName: "Basic",
        monthlyAllowance: "50",
        maxUnitsPerRequest: "10",
        used: "20",
        remaining: "30",
        exceeded: false
      },
      {
        id: "8",
        externalId: "customer-8",
        planId: "4",
        planName: "Premium",
        monthlyAllowance: "10",
        maxUnitsPerRequest: "5",
        used: "15",
        remaining: "0",
        exceeded: true
      }
    ]);

    expect(queryMock).toHaveBeenCalledTimes(2);

    for (const call of queryMock.mock.calls) {
      expect(call[1]).toEqual([
        "2",
        new Date("2026-10-01T00:00:00.000Z"),
        new Date("2026-11-01T00:00:00.000Z")
      ]);
    }

    const [accountSql] = queryMock.mock.calls[0] as [string, unknown[]];
    const [usersSql] = queryMock.mock.calls[1] as [string, unknown[]];

    expect(accountSql).toContain("c.status = 'accepted'");
    expect(accountSql).toContain("c.account_id = a.id");
    expect(usersSql).toContain("c.status = 'accepted'");
    expect(usersSql).toContain("c.account_id = u.account_id");
    expect(usersSql).toContain("ORDER BY u.id ASC");
  });

  it("returns zero remaining when usage exactly matches the allowance", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "2",
            planId: "1",
            planName: "Starter",
            monthlyAllowance: "100",
            maxUnitsPerRequest: "20",
            used: "100"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getMonthlyUsage("2", "2026-10");

    expect(result.account.remaining).toBe("0");
    expect(result.account.exceeded).toBe(false);
  });

  it("throws ACCOUNT_NOT_FOUND when the account does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      getMonthlyUsage("999", "2026-10")
    ).rejects.toThrow("ACCOUNT_NOT_FOUND");

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("supports zero allowance and very large usage values", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "2",
            planId: "1",
            planName: "Starter",
            monthlyAllowance: "0",
            maxUnitsPerRequest: "20",
            used: "9007199254740993"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getMonthlyUsage("2", "2026-10");

    expect(result.account.remaining).toBe("0");
    expect(result.account.exceeded).toBe(true);
    expect(result.account.used).toBe("9007199254740993");
  });
});
