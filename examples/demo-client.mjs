import { randomUUID } from "node:crypto";

const baseUrl = process.env.API_URL ?? "http://localhost:3000";
// The schema seeds Starter as plan 1 on a fresh database.
const starterPlanId = process.env.STARTER_PLAN_ID ?? "1";

async function request(path, { method = "GET", apiKey, body } = {}) {
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
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      `${method} ${path} returned ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

let apiKey;

// The "business action": ask the service, then show the decision and the
// remaining allowances. This function never changes between scenarios;
// only plans change.
async function consume(user, units, label, expected) {
  const { consumption } = await request("/api/consumption", {
    method: "POST",
    apiKey,
    body: { userId: user.id, requestId: `demo-${randomUUID()}`, units }
  });

  const { usage } = await request("/api/consumption/usage", { apiKey });
  const current = usage.users.find((u) => String(u.id) === String(user.id));
  const verdict =
    consumption.status === "accepted"
      ? "ACCEPTED"
      : `REJECTED (${consumption.rejectionReason})`;

  console.log(`\n> ${label}`);
  console.log(`  ${user.name} requests ${units} units -> ${verdict}`);
  console.log(
    `  remaining: account ${usage.account.remaining}/${usage.account.monthlyAllowance}` +
      ` (${usage.account.planName}) | ${user.name} ${current.remaining}/${current.monthlyAllowance}` +
      ` (${current.planName})`
  );

  const actual = consumption.rejectionReason ?? "accepted";

  if (actual !== expected) {
    throw new Error(
      `Unexpected decision for "${label}": expected ${expected}, got ${actual}`
    );
  }
}

async function main() {
  console.log("Usage Metering demo");
  console.log(`API: ${baseUrl}`);

  const created = await request("/api/accounts", {
    method: "POST",
    body: { name: `Demo ${new Date().toISOString()}`, planId: starterPlanId }
  });

  apiKey = created.apiKey;
  const accountId = created.account.id;

  console.log(`\nCreated isolated demo account ${accountId} (API key not printed)`);

  const { plans } = await request("/api/plans", { apiKey });
  const find = (name, scope) => {
    const plan = plans.find((p) => p.name === name && p.scope === scope);

    if (!plan) {
      throw new Error(`Predefined plan not found: ${name} (${scope})`);
    }

    return plan;
  };

  const pro = find("Pro", "account");
  const basic = find("Basic", "user");
  const premium = find("Premium", "user");

  const tag = Date.now();

  const accountPlan = (
    await request("/api/plans", {
      method: "POST",
      apiKey,
      body: {
        name: `Demo Account 150 ${tag}`,
        scope: "account",
        monthlyAllowance: "150",
        maxUnitsPerRequest: "1000"
      }
    })
  ).plan;

  const tightPlan = (
    await request("/api/plans", {
      method: "POST",
      apiKey,
      body: {
        name: `Demo Tight ${tag}`,
        scope: "user",
        monthlyAllowance: "60",
        maxUnitsPerRequest: "20"
      }
    })
  ).plan;

  await request(`/api/accounts/${accountId}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: accountPlan.id }
  });

  const makeUser = async (name, plan) => {
    const { user } = await request("/api/users", {
      method: "POST",
      apiKey,
      body: { externalId: `${name}-${tag}`.replace(/\s/g, "-"), planId: plan.id }
    });

    return { id: user.id, name };
  };

  const userA = await makeUser("User A", basic);
  const userB = await makeUser("User B", tightPlan);

  console.log("\nSetup:");
  console.log("  Account plan : custom, 150 units/month, 1000 per request");
  console.log("  User A       : Basic (1000/month, 100 per request)");
  console.log("  User B       : custom Tight (60/month, 20 per request)");

  console.log("\n=== Decisions with the plans above ===");
  await consume(userA, 80, "Within every limit", "accepted");
  await consume(userA, 101, "Above User A's per-request limit", "user_max_units_per_request");
  await consume(userB, 20, "User B within limits", "accepted");
  await consume(userB, 25, "Above User B's per-request limit", "user_max_units_per_request");
  await consume(userB, 20, "User B again", "accepted");
  await consume(userB, 20, "User B reaches its monthly allowance", "accepted");
  await consume(userB, 1, "User B has no monthly allowance left", "user_monthly_allowance");
  await consume(
    userA,
    11,
    "User A still has allowance, but the shared account has only 10 left",
    "account_monthly_allowance"
  );

  console.log("\n=== Switching User B from Tight to Premium (no client change) ===");
  await request(`/api/users/${userB.id}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: premium.id }
  });
  await consume(userB, 10, "User B now has room, and the account has exactly 10 left", "accepted");
  await consume(userB, 1, "Premium user, but the shared account is exhausted", "account_monthly_allowance");

  console.log("\n=== Upgrading the account from custom-150 to Pro ===");
  await request(`/api/accounts/${accountId}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: pro.id }
  });
  await consume(userB, 500, "Same user, same client code, larger account allowance", "accepted");

  console.log("\nDemo completed. Usage so far was preserved across every plan change.");
}

main().catch((error) => {
  console.error("\nDemo failed:", error.message);
  process.exitCode = 1;
});
