const baseUrl = process.env.API_URL ?? "http://localhost:3000";
const requestCount = Number(process.env.REQUESTS ?? 100);
const concurrency = Number(process.env.CONCURRENCY ?? 10);

if (
  !Number.isInteger(requestCount) ||
  requestCount < 1 ||
  requestCount > 1000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 100
) {
  console.error("REQUESTS must be 1–1000 and CONCURRENCY must be 1–100.");
  process.exit(1);
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json" };

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
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status}): ` +
      JSON.stringify(data)
    );
  }

  return data;
}

function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percent / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function main() {
  console.log("Usage Metering API load test");
  console.log(`API: ${baseUrl}`);
  console.log(`Requests: ${requestCount}`);
  console.log(`Concurrency: ${concurrency}`);

  const health = await request("/health/ready");

  if (health.status !== "ready") {
    throw new Error("API or database is not ready.");
  }

  // Create an isolated account; no existing account is modified.
  const created = await request("/api/accounts", {
    method: "POST",
    body: {
      name: `Load Test ${new Date().toISOString()}`,
      planId: "1"
    }
  });

  const apiKey = created.apiKey;
  const accountId = created.account.id;

  const { plans } = await request("/api/plans", { apiKey });
  const basicPlan = plans.find(
    (plan) => plan.name === "Basic" && plan.scope === "user"
  );

  if (!basicPlan) {
    throw new Error("Predefined Basic user plan was not found.");
  }

  const createdUser = await request("/api/users", {
    method: "POST",
    apiKey,
    body: {
      externalId: `load-test-${Date.now()}`,
      planId: basicPlan.id
    }
  });

  const userId = createdUser.user.id;

  console.log(`Isolated account: ${accountId}`);
  console.log(`Test user: ${userId}`);
  console.log("API key will not be printed.");
  console.log("\nSending requests...");

  const latencies = [];
  const failures = [];
  let nextRequest = 0;

  const testStarted = performance.now();

  async function worker() {
    while (true) {
      const index = nextRequest++;

      if (index >= requestCount) {
        return;
      }

      const requestId = `load-${accountId}-${Date.now()}-${index}`;
      const started = performance.now();

      try {
        const result = await request("/api/consumption", {
          method: "POST",
          apiKey,
          body: {
            userId,
            requestId,
            units: 1
          }
        });

        const elapsed = performance.now() - started;
        latencies.push(elapsed);

        if (result.consumption?.status !== "accepted") {
          failures.push({
            index,
            reason: result.consumption?.rejectionReason ?? "unexpected response"
          });
        }
      } catch (error) {
        latencies.push(performance.now() - started);
        failures.push({
          index,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, requestCount) },
      () => worker()
    )
  );

  const durationMs = performance.now() - testStarted;
  const successful = requestCount - failures.length;
  const throughput = requestCount / (durationMs / 1000);

  const usageResponse = await request(
    "/api/consumption/usage",
    { apiKey }
  );

  const accountUsage = usageResponse.usage.account;
  const userUsage = usageResponse.usage.users.find(
    (user) => String(user.id) === String(userId)
  );

  const report = {
    timestamp: new Date().toISOString(),
    apiUrl: baseUrl,
    requests: requestCount,
    concurrency,
    successful,
    failed: failures.length,
    durationMs: Number(durationMs.toFixed(2)),
    throughputRequestsPerSecond: Number(throughput.toFixed(2)),
    latencyMs: {
      min: Number(Math.min(...latencies).toFixed(2)),
      average: Number(
        (latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
          .toFixed(2)
      ),
      p50: Number(percentile(latencies, 50).toFixed(2)),
      p95: Number(percentile(latencies, 95).toFixed(2)),
      max: Number(Math.max(...latencies).toFixed(2))
    },
    accountUsageAfterTest: accountUsage.used,
    userUsageAfterTest: userUsage?.used ?? null,
    failures
  };

  console.log("\n--- Results ---");
  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Load test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
