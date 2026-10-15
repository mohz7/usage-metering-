import "dotenv/config";
import app from "./app.js";
import { pool } from "./db/pool.js";

const port = Number(process.env.PORT ?? 3000);

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
