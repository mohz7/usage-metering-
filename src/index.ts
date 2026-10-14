
import "dotenv/config";
import express from "express";
import { pool } from "./db/pool.js";
import accountsRouter from "./routes/accounts.routes.js";
import consumptionRouter from "./routes/consumption.routes.js";
import plansRouter from "./routes/plans.routes.js";
import usersRouter from "./routes/users.routes.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "usage-metering"
  });
});

app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "ready",
      database: "connected"
    });
  } catch (error) {
    console.error("Database readiness check failed:", error);

    res.status(503).json({
      status: "not_ready",
      database: "disconnected"
    });
  }
});

app.use("/api/plans", plansRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/users", usersRouter);
app.use("/api/consumption", consumptionRouter);

const server = app.listen(port, () => {
  console.log(`Usage Metering API is running on port ${port}`);
});

function shutdown() {
  server.close(() => {
    void pool.end().then(() => {
      process.exitCode = 0;
    }).catch((error: unknown) => {
      console.error("Failed to close database pool:", error);
      process.exitCode = 1;
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
