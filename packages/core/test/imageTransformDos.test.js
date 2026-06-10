import { test, expect, describe, beforeAll, afterAll, afterEach } from "@jest/globals";
import sharp from "sharp";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import AssetsService from "../baasix/services/AssetsService";
import env from "../baasix/utils/env";

/**
 * A13 — image-transform DoS hardening.
 *
 * Output width/height are clamped to ASSET_MAX_DIMENSION; quality is clamped to
 * 1–100; format/fit are validated. processImageBuffer is a pure transform over a
 * buffer; we boot the server only so the AssetsService constructor's schema
 * registry is available, then call the transform directly.
 */

let app;
let service;
let baseImage; // a small valid source image

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();
  service = new AssetsService({});
  // A 200x200 red PNG to transform.
  baseImage = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

afterEach(() => {
  env.set("ASSET_MAX_DIMENSION", "5000");
});

describe("A13 — output dimensions are clamped", () => {
  test("an absurd requested width is clamped to ASSET_MAX_DIMENSION (no giant allocation)", async () => {
    const { buffer } = await service.processImageBuffer(baseImage, {
      width: "100000",
      height: "100000",
      format: "png",
      withoutEnlargement: false,
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(5000);
    expect(meta.height).toBeLessThanOrEqual(5000);
  });

  test("a normal requested size is honored exactly", async () => {
    const { buffer } = await service.processImageBuffer(baseImage, {
      width: "120",
      height: "80",
      format: "png",
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(80);
  });

  test("the dimension cap is configurable via ASSET_MAX_DIMENSION", async () => {
    env.set("ASSET_MAX_DIMENSION", "300");
    const { buffer } = await service.processImageBuffer(baseImage, {
      width: "9999",
      format: "png",
      withoutEnlargement: false,
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(300);
  });
});

describe("A13 — quality / format validation", () => {
  test("out-of-range quality does not throw (clamped)", async () => {
    // quality 9999 would be invalid for sharp; must be clamped, not error.
    await expect(
      service.processImageBuffer(baseImage, { width: "50", quality: "9999", format: "jpeg" })
    ).resolves.toHaveProperty("buffer");
    await expect(
      service.processImageBuffer(baseImage, { width: "50", quality: "-5", format: "jpeg" })
    ).resolves.toHaveProperty("buffer");
  });

  test("unknown format falls back to jpeg", async () => {
    const out = await service.processImageBuffer(baseImage, { width: "50", format: "exe" });
    expect(out.contentType).toBe("image/jpeg");
  });

  test("supported formats produce the right content-type", async () => {
    expect((await service.processImageBuffer(baseImage, { width: "50", format: "webp" })).contentType).toBe("image/webp");
    expect((await service.processImageBuffer(baseImage, { width: "50", format: "png" })).contentType).toBe("image/png");
  });
});
