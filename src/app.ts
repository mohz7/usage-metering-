import "dotenv/config";
import express from "express";
import { pool } from "./db/pool.js";
import accountsRouter from "./routes/accounts.routes.js";
import consumptionRouter from "./routes/consumption.routes.js";
import plansRouter from "./routes/plans.routes.js";
import usersRouter from "./routes/users.routes.js";

const app = express();

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

export default app;
