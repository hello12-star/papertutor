import { createServer } from "node:http";
import { handler } from "../functions/handler.ts";

const server = createServer(async (req, res) => {
  try {
    const url = `http://127.0.0.1:8000${req.url ?? "/"}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
      else if (value) headers.set(key, value);
    }
    const method = req.method ?? "GET";
    const request = new Request(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : req,
      duplex: "half",
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(error) }));
  }
});

const port = Number(process.env.PORT || 8000);
server.listen(port, "127.0.0.1", () => {
  console.log(`papertutor function (node adapter) on http://127.0.0.1:${port}`);
});