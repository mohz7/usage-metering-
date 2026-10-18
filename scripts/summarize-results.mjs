import { readdirSync, readFileSync } from "node:fs";

const files = readdirSync("performance")
  .filter((f) => f.startsWith("correctness-") && f.endsWith(".json"))
  .sort();

console.log(
  "| Run | Accounts | Users/acct | Requests | Concurrency | Req/s | p50 ms | p95 ms | p99 ms | Accepted | Rejected | HTTP errors | Totals match |"
);
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");

for (const file of files) {
  const r = JSON.parse(readFileSync(`performance/${file}`, "utf8"));
  console.log(
    `| ${file.replace(".json", "")} | ${r.accounts} | ${r.usersPerAccount} | ${r.requests} | ${r.concurrency} | ` +
      `${r.throughputRequestsPerSecond} | ${r.latencyMs.p50} | ${r.latencyMs.p95} | ${r.latencyMs.p99} | ` +
      `${r.accepted} | ${r.rejected} | ${r.httpErrors} | ${r.totalsMatch ? "yes" : "NO"} |`
  );
}
