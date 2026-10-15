
const baseUrl = process.env.API_URL ?? "http://localhost:3000";

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

function showResult(label, result) {
  const consumption = result.consumption;

  console.log(`\n--- ${label} ---`);
  console.log(`Decision: ${consumption.status}`);
  console.log(`Units: ${consumption.units}`);
  console.log(`Reason: ${consumption.rejectionReason ?? "none"}`);
  console.log(`Request ID: ${consumption.requestId}`);
  console.log(`Replayed: ${consumption.replayed}`);
}

async function showUsage(apiKey) {
  const result = await request("/api/consumption/usage", { apiKey });
  const { account, users } = result.usage;

  console.log("\nCurrent usage:");
  console.log(
    `Account ${account.id} (${account.planName}): ` +
    `${account.used}/${account.monthlyAllowance} used, ` +
    `${account.remaining} remaining`
  );

  for (const user of users) {
    console.log(
      `User ${user.id} (${user.externalId}, ${user.planName}): ` +
      `${user.used}/${user.monthlyAllowance} used, ` +
      `${user.remaining} remaining`
    );
  }
}

async function consume(apiKey, userId, requestId, units) {
  const result = await request("/api/consumption", {
    method: "POST",
    apiKey,
    body: { userId, requestId, units }
  });

  showResult(`Consume ${units} units`, result);
  return result.consumption;
}

async function main() {
  console.log("Usage Metering demo");
  console.log(`API: ${baseUrl}`);

  // The schema seeds Starter as the first account plan on a fresh database.
  // This project currently uses that predefined plan ID to create the account.
  const created = await request("/api/accounts", {
    method: "POST",
    body: {
      name: `Docker Demo ${new Date().toISOString()}`,
      planId: "1"
    }
  });

  const accountId = created.account.id;
  const apiKey = created.apiKey;

  console.log(`\nCreated isolated demo account: ${accountId}`);
  console.log("API key issued. It will not be printed.");

  const { plans } = await request("/api/plans", { apiKey });

  const findPlan = (name, scope) => {
    const plan = plans.find(
      (item) => item.name === name && item.scope === scope
    );

    if (!plan) {
      throw new Error(`Required predefined plan not found: ${name} (${scope})`);
    }

    return plan;
  };

  const proPlan = findPlan("Pro", "account");
  const basicPlan = findPlan("Basic", "user");

  const customPlanResponse = await request("/api/plans", {
    method: "POST",
    apiKey,
    body: {
      name: "Docker Demo Account Limit",
      scope: "account",
      monthlyAllowance: "150",
      maxUnitsPerRequest: "1000"
    }
  });

  const customPlan = customPlanResponse.plan;

  await request(`/api/accounts/${accountId}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: customPlan.id }
  });

  const firstUser = await request("/api/users", {
    method: "POST",
    apiKey,
    body: {
      externalId: `demo-user-a-${Date.now()}`,
      planId: basicPlan.id
    }
  });

  const secondUser = await request("/api/users", {
    method: "POST",
    apiKey,
    body: {
      externalId: `demo-user-b-${Date.now()}`,
      planId: basicPlan.id
    }
  });

  const userA = firstUser.user;
  const userB = secondUser.user;

  console.log(`Demo account plan: ${customPlan.name} (150 units/month)`);
  console.log(`User A: ${userA.id} (${userA.planName})`);
  console.log(`User B: ${userB.id} (${userB.planName})`);

  await consume(apiKey, userA.id, `demo-${Date.now()}-accepted-a`, 80);
  await consume(apiKey, userA.id, `demo-${Date.now()}-user-limit`, 101);
  await consume(apiKey, userB.id, `demo-${Date.now()}-accepted-b`, 70);
  await consume(apiKey, userB.id, `demo-${Date.now()}-account-limit`, 1);

  await showUsage(apiKey);

  console.log("\nUpgrading demo account to Pro...");
  await request(`/api/accounts/${accountId}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: proPlan.id }
  });

  await consume(apiKey, userB.id, `demo-${Date.now()}-after-upgrade`, 1);
  await showUsage(apiKey);

  console.log("\nDemo completed.");
}

main().catch((error) => {
  console.error("\nDemo failed:", error.message);
  process.exitCode = 1;
});
