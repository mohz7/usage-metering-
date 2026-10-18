import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Integration tests run against a live API + PostgreSQL:
//   API_URL=http://localhost:3000 npm run test:integration
// Without API_URL the whole suite is skipped, so `npm test` stays DB-free.

const baseUrl = process.env.API_URL;
const starterPlanId = process.env.STARTER_PLAN_ID ?? "1";
const suite = baseUrl ? describe : describe.skip;

type Json = any;
type ApiResult = { status: number; data: Json };

async function api(
  path: string,
  options: { method?: string; apiKey?: string; body?: unknown } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (options.apiKey) {
    headers["X-API-Key"] = options.apiKey;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) })
  });

  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : {} };
}

async function must(
  path: string,
  options: { method?: string; apiKey?: string; body?: unknown } = {}
): Promise<Json> {
  const result = await api(path, options);

  if (result.status >= 400) {
    throw new Error(
      `${options.method ?? "GET"} ${path} -> ${result.status} ${JSON.stringify(result.data)}`
    );
  }

  return result.data;
}

function at<T>(items: T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`No item at index ${index}`);
  }

  return item;
}

async function setup(options: {
  accountMonthly: number;
  accountPerRequest: number;
  userMonthly: number;
  userPerRequest: number;
  userCount: number;
}) {
  const tag = randomUUID().slice(0, 8);

  const created = await must("/api/accounts", {
    method: "POST",
    body: { name: `it-${tag}`, planId: starterPlanId }
  });

  const apiKey: string = created.apiKey;
  const accountId: string = created.account.id;

  const accountPlan = (
    await must("/api/plans", {
      method: "POST",
      apiKey,
      body: {
        name: `acct-${tag}`,
        scope: "account",
        monthlyAllowance: String(options.accountMonthly),
        maxUnitsPerRequest: String(options.accountPerRequest)
      }
    })
  ).plan;

  await must(`/api/accounts/${accountId}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: accountPlan.id }
  });

  const userPlan = (
    await must("/api/plans", {
      method: "POST",
      apiKey,
      body: {
        name: `user-${tag}`,
        scope: "user",
        monthlyAllowance: String(options.userMonthly),
        maxUnitsPerRequest: String(options.userPerRequest)
      }
    })
  ).plan;

  const userIds: string[] = [];

  for (let i = 0; i < options.userCount; i++) {
    const created = await must("/api/users", {
      method: "POST",
      apiKey,
      body: { externalId: `u${i}-${tag}`, planId: userPlan.id }
    });

    userIds.push(String(created.user.id));
  }

  return { apiKey, accountId, accountPlan, userIds };
}

function consume(
  apiKey: string,
  userId: string,
  units: number,
  requestId: string = randomUUID()
) {
  return api("/api/consumption", {
    method: "POST",
    apiKey,
    body: { userId, requestId, units }
  });
}

function decisions(results: ApiResult[]) {
  expect(results.every((r) => r.status === 200)).toBe(true);

  const accepted = results.filter(
    (r) => r.data.consumption.status === "accepted"
  );
  const rejected = results.filter(
    (r) => r.data.consumption.status === "rejected"
  );
  const reasons = [
    ...new Set(rejected.map((r) => r.data.consumption.rejectionReason))
  ];

  return { accepted, rejected, reasons };
}

async function usage(apiKey: string): Promise<Json> {
  return (await must("/api/consumption/usage", { apiKey })).usage;
}

suite("quota enforcement against a real database", () => {
  it("never exceeds the shared account allowance under concurrent requests", async () => {
    const s = await setup({
      accountMonthly: 50,
      accountPerRequest: 10,
      userMonthly: 1000,
      userPerRequest: 10,
      userCount: 1
    });
    const userId = at(s.userIds, 0);

    const results = await Promise.all(
      Array.from({ length: 40 }, () => consume(s.apiKey, userId, 5))
    );

    const { accepted, rejected, reasons } = decisions(results);

    expect(accepted).toHaveLength(10);
    expect(rejected).toHaveLength(30);
    expect(reasons).toEqual(["account_monthly_allowance"]);

    const u = await usage(s.apiKey);
    expect(u.account.used).toBe("50");
    expect(u.account.remaining).toBe("0");
    expect(at(u.users as Json[], 0).used).toBe("50");
  }, 30_000);

  it("enforces each user's allowance separately while sharing the account total", async () => {
    const s = await setup({
      accountMonthly: 1000,
      accountPerRequest: 10,
      userMonthly: 30,
      userPerRequest: 10,
      userCount: 2
    });

    const calls: Promise<ApiResult>[] = [];

    for (let i = 0; i < 20; i++) {
      for (const userId of s.userIds) {
        calls.push(consume(s.apiKey, userId, 5));
      }
    }

    const { accepted, rejected, reasons } = decisions(
      await Promise.all(calls)
    );

    expect(accepted).toHaveLength(12);
    expect(rejected).toHaveLength(28);
    expect(reasons).toEqual(["user_monthly_allowance"]);

    const u = await usage(s.apiKey);
    expect(u.account.used).toBe("60");

    for (const user of u.users as Json[]) {
      expect(user.used).toBe("30");
      expect(user.remaining).toBe("0");
    }
  }, 30_000);

  it("counts a retried request ID once, even when retries arrive concurrently", async () => {
    const s = await setup({
      accountMonthly: 1000,
      accountPerRequest: 10,
      userMonthly: 1000,
      userPerRequest: 10,
      userCount: 1
    });
    const userId = at(s.userIds, 0);
    const requestId = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        consume(s.apiKey, userId, 5, requestId)
      )
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(
      results.filter((r) => r.data.consumption.replayed === false)
    ).toHaveLength(1);
    expect(
      results.every((r) => r.data.consumption.status === "accepted")
    ).toBe(true);

    expect((await usage(s.apiKey)).account.used).toBe("5");

    const conflict = await consume(s.apiKey, userId, 7, requestId);
    expect(conflict.status).toBe(409);
    expect(conflict.data.error).toBe("idempotency_conflict");
  }, 30_000);

  it("keeps usage when an allowance is reduced and restores access when raised", async () => {
    const s = await setup({
      accountMonthly: 50,
      accountPerRequest: 10,
      userMonthly: 1000,
      userPerRequest: 10,
      userCount: 1
    });
    const userId = at(s.userIds, 0);

    expect((await consume(s.apiKey, userId, 10)).data.consumption.status).toBe(
      "accepted"
    );

    await must(`/api/plans/${s.accountPlan.id}`, {
      method: "PUT",
      apiKey: s.apiKey,
      body: {
        name: s.accountPlan.name,
        monthlyAllowance: "5",
        maxUnitsPerRequest: "10"
      }
    });

    const reduced = await usage(s.apiKey);
    expect(reduced.account.used).toBe("10");
    expect(reduced.account.remaining).toBe("0");
    expect(reduced.account.exceeded).toBe(true);

    const blocked = await consume(s.apiKey, userId, 1);
    expect(blocked.data.consumption.status).toBe("rejected");
    expect(blocked.data.consumption.rejectionReason).toBe(
      "account_monthly_allowance"
    );

    await must(`/api/plans/${s.accountPlan.id}`, {
      method: "PUT",
      apiKey: s.apiKey,
      body: {
        name: s.accountPlan.name,
        monthlyAllowance: "100",
        maxUnitsPerRequest: "10"
      }
    });

    const allowed = await consume(s.apiKey, userId, 1);
    expect(allowed.data.consumption.status).toBe("accepted");
    expect((await usage(s.apiKey)).account.used).toBe("11");
  }, 30_000);

  it("isolates accounts from each other and rejects bad API keys", async () => {
    const a = await setup({
      accountMonthly: 100,
      accountPerRequest: 10,
      userMonthly: 100,
      userPerRequest: 10,
      userCount: 1
    });
    const b = await setup({
      accountMonthly: 100,
      accountPerRequest: 10,
      userMonthly: 100,
      userPerRequest: 10,
      userCount: 1
    });
    const userA = at(a.userIds, 0);

    await consume(a.apiKey, userA, 5);

    const crossConsume = await consume(b.apiKey, userA, 1);
    expect(crossConsume.status).toBe(404);
    expect(crossConsume.data.error).toBe("user_not_found");

    expect(
      (await api(`/api/users/${userA}`, { apiKey: b.apiKey })).status
    ).toBe(404);
    expect(
      (await api(`/api/accounts/${a.accountId}`, { apiKey: b.apiKey })).status
    ).toBe(404);

    const stolenPlan = await api(`/api/accounts/${b.accountId}/plan`, {
      method: "PATCH",
      apiKey: b.apiKey,
      body: { planId: a.accountPlan.id }
    });
    expect(stolenPlan.status).toBeGreaterThanOrEqual(400);
    expect(stolenPlan.status).toBeLessThan(500);

    expect((await usage(b.apiKey)).account.used).toBe("0");
    expect((await usage(a.apiKey)).account.used).toBe("5");

    const missing = await api("/api/consumption/usage");
    expect(missing.status).toBe(401);
    expect(missing.data.error).toBe("missing_api_key");

    const unknown = await api("/api/consumption/usage", {
      apiKey: `um_${"0".repeat(64)}`
    });
    expect(unknown.status).toBe(401);
    expect(unknown.data.error).toBe("invalid_api_key");
  }, 30_000);
});
