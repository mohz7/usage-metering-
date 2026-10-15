import { createServer, type Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

const { queryMock, endMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  endMock: vi.fn()
}));

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: queryMock,
    end: endMock,
    on: vi.fn()
  }
}));

import app from "../src/app.js";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const addressInfo = server.address();

      if (addressInfo === null || typeof addressInfo === "string") {
        reject(new Error("Could not determine test server address"));
        return;
      }

      baseUrl = `http://127.0.0.1:${addressInfo.port}`;
      resolve();
    });
  });
});

beforeEach(() => {
  queryMock.mockReset();
  endMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

describe("GET /health", () => {
  it("returns the service health status without querying the database", async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      service: "usage-metering"
    });
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("GET /health/ready", () => {
  it("returns ready when the database query succeeds", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ "?column?": 1 }]
    });

    const response = await fetch(`${baseUrl}/health/ready`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ready",
      database: "connected"
    });
    expect(queryMock).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns 503 when the database query fails", async () => {
    queryMock.mockRejectedValueOnce(
      new Error("Database unavailable")
    );

    const response = await fetch(`${baseUrl}/health/ready`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "not_ready",
      database: "disconnected"
    });
    expect(queryMock).toHaveBeenCalledWith("SELECT 1");
  });
});
