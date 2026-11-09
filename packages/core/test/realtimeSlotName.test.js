import { test, expect, describe, afterAll } from "@jest/globals";
import env from "../baasix/utils/env.js";
import { getSlotName } from "../baasix/services/RealtimeService.js";

describe("Realtime replication slot name", () => {
    const originalUrl = env.get("DATABASE_URL");
    afterAll(() => {
        env.set("REALTIME_SLOT_APPEND_DB_NAME", "false");
        env.set("DATABASE_URL", originalUrl);
    });

    test("default is the plain slot name", () => {
        env.set("REALTIME_SLOT_APPEND_DB_NAME", "false");
        expect(getSlotName()).toBe("baasix_realtime_slot");
    });

    test("appends a sanitized database name when enabled", () => {
        env.set("REALTIME_SLOT_APPEND_DB_NAME", "true");
        env.set("DATABASE_URL", "postgresql://u:p@localhost:5432/My-App.Prod?sslmode=require");
        expect(getSlotName()).toBe("baasix_realtime_slot_my_app_prod");
    });

    test("caps the name at Postgres' 63-char limit", () => {
        env.set("REALTIME_SLOT_APPEND_DB_NAME", "true");
        env.set("DATABASE_URL", `postgresql://localhost/${"x".repeat(80)}`);
        expect(getSlotName()).toHaveLength(63);
    });
});
