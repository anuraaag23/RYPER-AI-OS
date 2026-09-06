import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeHttpFetch } from "../../src/providers/node-fetch.js";

/**
 * REAL TEST — not a fetch mock. Spins up a genuine local `node:http`
 * server and exercises `createNodeHttpFetch()`'s real `fetch()`-backed
 * implementation against it, including a real streamed response body.
 */
describe("createNodeHttpFetch (real fetch, real local HTTP server)", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("hello");
        return;
      }
      if (req.url === "/echo-headers") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ auth: req.headers["authorization"] ?? null }));
        return;
      }
      if (req.url === "/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("chunk1\n");
        setTimeout(() => {
          res.write("chunk2\n");
          res.end();
        }, 10);
        return;
      }
      if (req.url === "/fail") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("server error");
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no server address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("performs a real GET request and reads the real response text", async () => {
    const httpFetch = createNodeHttpFetch();
    const response = await httpFetch(`${baseUrl}/ok`, { method: "GET", headers: {} });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
  });

  it("sends real custom headers", async () => {
    const httpFetch = createNodeHttpFetch();
    const response = await httpFetch(`${baseUrl}/echo-headers`, {
      method: "GET",
      headers: { authorization: "Bearer real-token" },
    });
    const body = JSON.parse(await response.text());
    expect(body.auth).toBe("Bearer real-token");
  });

  it("sends a real POST body", async () => {
    const httpFetch = createNodeHttpFetch();
    const response = await httpFetch(`${baseUrl}/ok`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(response.ok).toBe(true);
  });

  it("reports a real non-2xx status honestly rather than throwing", async () => {
    const httpFetch = createNodeHttpFetch();
    const response = await httpFetch(`${baseUrl}/fail`, { method: "GET", headers: {} });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
  });

  it("exposes a real, async-iterable streamed response body", async () => {
    const httpFetch = createNodeHttpFetch();
    const response = await httpFetch(`${baseUrl}/stream`, { method: "GET", headers: {} });
    const body = response.body();
    expect(body).not.toBeNull();

    const decoder = new TextDecoder();
    let collected = "";
    for await (const chunk of body!) {
      collected += decoder.decode(chunk, { stream: true });
    }
    expect(collected).toContain("chunk1");
    expect(collected).toContain("chunk2");
  });

  it("honors a real AbortSignal, cancelling an in-flight request", async () => {
    const httpFetch = createNodeHttpFetch();
    const controller = new AbortController();
    const promise = httpFetch(`${baseUrl}/stream`, {
      method: "GET",
      headers: {},
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toThrow();
  });
});
