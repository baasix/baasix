import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * A6 — stored XSS via uploads.
 *
 * The file `type` is taken from the client's upload, so an attacker can upload
 * HTML/SVG/JS and have it stored with an executable content-type. When served,
 * such types must NEVER render inline in the app origin — they are forced to
 * download with a neutral content-type, and X-Content-Type-Options: nosniff is
 * always set. Legitimate images continue to serve inline.
 */

let app;
let adminToken;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();

  const adminLogin = await request(app)
    .post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = adminLogin.body.token;
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

async function uploadBuffer(buffer, filename, contentType) {
  const res = await request(app)
    .post("/files")
    .set("Authorization", `Bearer ${adminToken}`)
    .attach("file", buffer, { filename, contentType });
  return res.body.data; // file id
}

describe("A6 — uploaded HTML/SVG is not served inline (stored XSS guard)", () => {
  test("HTML upload is forced to download with a neutral type, not text/html inline", async () => {
    const html = Buffer.from("<script>document.title='xss'</script>", "utf8");
    const id = await uploadBuffer(html, "evil.html", "text/html");
    expect(id).toBeTruthy();

    const res = await request(app)
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Must NOT be served as renderable html inline
    expect(res.headers["content-type"]).not.toMatch(/text\/html/);
    expect(res.headers["content-type"]).toMatch(/application\/octet-stream/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("SVG upload is forced to download (SVG can carry scripts)", async () => {
    // Well-formed SVG (explicit dimensions so it's accepted on upload) that still
    // carries a script — the realistic stored-XSS payload.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
      "utf8"
    );
    const id = await uploadBuffer(svg, "evil.svg", "image/svg+xml");
    expect(id).toBeTruthy();

    const res = await request(app)
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).not.toMatch(/image\/svg\+xml/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("legitimate image still serves inline with its content-type + nosniff", async () => {
    // A tiny valid PNG (1x1)
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082",
      "hex"
    );
    const id = await uploadBuffer(png, "ok.png", "image/png");

    const res = await request(app)
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(res.headers["content-disposition"]).toMatch(/inline/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
