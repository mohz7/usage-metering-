import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

function intEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isInteger(value) || value < 1) {
    console.error(`${name} must be a positive integer`);
    process.exit(1);
  }

  return value;
}

const baseUrl = process.env.API_URL ?? "http://localhost:3000";
const starterPlanId = process.env.STARTER_PLAN_ID ?? "1";
const requests = intEnv("REQUESTS", 2000);
const concurrency = intEnv("CONCURRENCY", 20);
const accountCount = intEnv("ACCOUNTS", 1);
const usersPerAccount = intEnv("USERS", 10);
const accountMonthly = intEnv("ACCOUNT_MONTHLY", 3000);
const userMonthly = intEnv("USER_MONTHLY", 400);
const seed = intEnv("SEED", 42);
const outFile = process.env.OUT;

function mulberry32(initial) {
  let a = initial >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function call(path, { method = "GET", apiKey, body } = {}) {
  const headers = { "Content-Type": "application/json" };

  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  return { status: response.status, data };
}

async function must(path, options) {
  const result = await call(path, options);

  if (result.status >= 400) {
    throw new Error(
      `${options?.method ?? "GET"} ${path} -> ${result.status} ${JSON.stringify(result.data)}`
    );
  }

  return result.data;
}

function percentile(sorted, percent) {
  const index = Math.ceil((percent / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function createTarget() {
  const tag = randomUUID().slice(0, 8);

  const created = await must("/api/accounts", {
    method: "POST",
    body: { name: `lt-${tag}`, planId: starterPlanId }
  });

  const apiKey = created.apiKey;

  const accountPlan = (
    await must("/api/plans", {
      method: "POST",
      apiKey,
      body: {
        name: `lt-acct-${tag}`,
        scope: "account",
        monthlyAllowance: String(accountMonthly),
        maxUnitsPerRequest: "10"
      }
    })
  ).plan;

  await must(`/api/accounts/${created.account.id}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: accountPlan.id }
  });

  const userPlan = (
    await must("/api/plans", {
      method: "POST",
      apiKey,
      body: {
        name: `lt-user-${tag}`,
        scope: "user",
        monthlyAllowance: String(userMonthly),
        maxUnitsPerRequest: "10"
      }
    })
  ).plan;

  const users = [];

  for (let i = 0; i < usersPerAccount; i++) {
    const { user } = await must("/api/users", {
      method: "POST",
      apiKey,
      body: { externalId: `lt-u${i}-${tag}`, planId: userPlan.id }
    });

    users.push(String(user.id));
  }

  return { apiKey, users, acceptedTotal: 0, perUser: new Map() };
}

async function main() {
  console.log(
    `Correctness load test: ${requests} requests, concurrency ${concurrency}, ` +
      `${accountCount} account(s) x ${usersPerAccount} users`
  );

  const health = await must("/health/ready");

  if (health.status !== "ready") {
    throw new Error("API or database is not ready.");
  }

  const targets = [];

  for (let i = 0; i < accountCount; i++) {
    targets.push(await createTarget());
  }

  const random = mulberry32(seed);
  const latencies = [];
  const httpErrors = [];
  const rejectedByReason = {};
  let accepted = 0;
  let rejected = 0;
  let next = 0;

  const startedAt = performance.now();

  async function worker() {
    for (;;) {
      const index = next++;

      if (index >= requests) {
        return;
      }

      const target = targets[index % targets.length];
      const userId = target.users[Math.floor(random() * target.users.length)];
      const units = 1 + Math.floor(random() * 5);
      const started = performance.now();

      try {
        const result = await call("/api/consumption", {
          method: "POST",
          apiKey: target.apiKey,
          body: { userId, requestId: `lt-${randomUUID()}`, units }
        });

        latencies.push(performance.now() - started);

        if (result.status !== 200) {
          httpErrors.push({ status: result.status, error: result.data.error });
          continue;
        }

        const decision = result.data.consumption;

        if (decision.status === "accepted") {
          accepted++;
          target.acceptedTotal += units;
          target.perUser.set(userId, (target.perUser.get(userId) ?? 0) + units);
        } else {
          rejected++;
          rejectedByReason[decision.rejectionReason] =
            (rejectedByReason[decision.rejectionReason] ?? 0) + 1;
        }
      } catch (error) {
        latencies.push(performance.now() - started);
        httpErrors.push({
          status: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, requests) }, () => worker())
  );

  const durationMs = performance.now() - startedAt;

  // Verify: what the service reports must equal what the client saw accepted,
  // and no allowance may ever be exceeded.
  const mismatches = [];

  for (const [position, target] of targets.entries()) {
    const { usage } = await must("/api/consumption/usage", {
      apiKey: target.apiKey
    });

    if (usage.account.used !== String(target.acceptedTotal)) {
      mismatches.push(
        `account ${position}: service=${usage.account.used} client=${target.acceptedTotal}`
      );
    }

    if (Number(usage.account.used) > accountMonthly) {
      mismatches.push(`account ${position} exceeded its allowance`);
    }

    for (const user of usage.users) {
      const expected = target.perUser.get(String(user.id)) ?? 0;

      if (user.used !== String(expected)) {
        mismatches.push(
          `account ${position} user ${user.id}: service=${user.used} client=${expected}`
        );
      }

      if (Number(user.used) > userMonthly) {
        mismatches.push(`account ${position} user ${user.id} exceeded its allowance`);
      }
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const round = (value) => Number(value.toFixed(2));

  const report = {
    timestamp: new Date().toISOString(),
    accounts: accountCount,
    usersPerAccount,
    requests,
    concurrency,
    accountMonthly,
    userMonthly,
    durationMs: round(durationMs),
    throughputRequestsPerSecond: round(requests / (durationMs / 1000)),
    latencyMs: {
      p50: round(percentile(sorted, 50)),
      p95: round(percentile(sorted, 95)),
      p99: round(percentile(sorted, 99)),
      max: round(sorted[sorted.length - 1])
    },
    accepted,
    rejected,
    rejectedByReason,
    httpErrors: httpErrors.length,
    totalsMatch: mismatches.length === 0,
    mismatches
  };

  console.log(JSON.stringify(report, null, 2));

  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Saved ${outFile}`);
  }

  if (mismatches.length > 0 || httpErrors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Load test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
