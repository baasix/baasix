import { describe, test, expect } from "@jest/globals";
import { resolveSessionLimit } from "../baasix/auth/services/sessionLimits";

const role = { id: "role-1", name: "user" };

describe("resolveSessionLimit", () => {
    test("administrator role is always unlimited", () => {
        const settings = { session_limits: { default: { web: 0 } } };
        const admin = { id: "r0", name: "administrator" };
        expect(resolveSessionLimit(settings, null, admin, "web")).toBe(-1);
    });

    test("user override wins over role and default", () => {
        const settings = { session_limits: { default: { web: 1 }, roles: { "role-1": { web: 2 } } } };
        const user = { session_limits: { web: 10 } };
        expect(resolveSessionLimit(settings, user, role, "web")).toBe(10);
    });

    test("user override of -1 exempts the user", () => {
        const settings = { session_limits: { default: { web: 1 } } };
        const user = { session_limits: { web: -1 } };
        expect(resolveSessionLimit(settings, user, role, "web")).toBe(-1);
    });

    test("role limit wins over default", () => {
        const settings = { session_limits: { default: { web: 1 }, roles: { "role-1": { web: 5 } } } };
        expect(resolveSessionLimit(settings, null, role, "web")).toBe(5);
    });

    test("role entry missing the session type falls through to default", () => {
        const settings = { session_limits: { default: { mobile: 3 }, roles: { "role-1": { web: 5 } } } };
        expect(resolveSessionLimit(settings, null, role, "mobile")).toBe(3);
    });

    test("default applies when role has no entry", () => {
        const settings = { session_limits: { default: { web: 2 }, roles: { "other-role": { web: 9 } } } };
        expect(resolveSessionLimit(settings, null, role, "web")).toBe(2);
    });

    test("no configuration means unlimited", () => {
        expect(resolveSessionLimit({}, null, role, "web")).toBe(-1);
        expect(resolveSessionLimit(null, null, null, "web")).toBe(-1);
        expect(resolveSessionLimit({ session_limits: null }, null, role, "web")).toBe(-1);
    });

    test("zero blocks the type", () => {
        const settings = { session_limits: { default: { mobile: 0 } } };
        expect(resolveSessionLimit(settings, null, role, "mobile")).toBe(0);
    });

    test("malformed shapes fail open to unlimited", () => {
        expect(resolveSessionLimit({ session_limits: "garbage" }, null, role, "web")).toBe(-1);
        expect(resolveSessionLimit({ session_limits: [1, 2] }, null, role, "web")).toBe(-1);
        expect(resolveSessionLimit({ session_limits: { default: { web: "two" } } }, null, role, "web")).toBe(-1);
        expect(resolveSessionLimit({ session_limits: { default: { web: 1.5 } } }, null, role, "web")).toBe(-1);
        expect(resolveSessionLimit({ session_limits: { default: { web: -2 } } }, null, role, "web")).toBe(-1);
        expect(resolveSessionLimit(null, { session_limits: "nope" }, role, "web")).toBe(-1);
    });

    test("numeric role ids are matched via string key", () => {
        const settings = { session_limits: { roles: { "42": { web: 4 } } } };
        expect(resolveSessionLimit(settings, null, { id: 42, name: "user" }, "web")).toBe(4);
    });
});
