import { describe, test, expect } from "@jest/globals";
import { convertLegacySessionLimits } from "../baasix/migrations/0.1.82_session_limits_restructure";

describe("convertLegacySessionLimits", () => {
    test("no roles list becomes a default entry", () => {
        expect(convertLegacySessionLimits({
            mobile_session_limit: 1, web_session_limit: 2, session_limit_roles: null,
        })).toEqual({ default: { web: 2, mobile: 1 } });
    });

    test("empty roles array also becomes a default entry", () => {
        expect(convertLegacySessionLimits({
            mobile_session_limit: 0, web_session_limit: 3, session_limit_roles: [],
        })).toEqual({ default: { web: 3, mobile: 0 } });
    });

    test("roles list becomes per-role entries with no default (unlisted roles stay unlimited)", () => {
        expect(convertLegacySessionLimits({
            mobile_session_limit: 1, web_session_limit: 2, session_limit_roles: ["r1", "r2"],
        })).toEqual({ roles: { r1: { web: 2, mobile: 1 }, r2: { web: 2, mobile: 1 } } });
    });

    test("roles list serialized as a JSON string is parsed", () => {
        expect(convertLegacySessionLimits({
            web_session_limit: 1, mobile_session_limit: null, session_limit_roles: '["r1"]',
        })).toEqual({ roles: { r1: { web: 1 } } });
    });

    test("-1 and null limits are omitted (unlimited is the fall-through)", () => {
        expect(convertLegacySessionLimits({
            mobile_session_limit: -1, web_session_limit: 2, session_limit_roles: null,
        })).toEqual({ default: { web: 2 } });
    });

    test("nothing meaningful returns null (leave column NULL)", () => {
        expect(convertLegacySessionLimits({
            mobile_session_limit: null, web_session_limit: -1, session_limit_roles: null,
        })).toBeNull();
        expect(convertLegacySessionLimits({})).toBeNull();
    });

    test("zero is meaningful and preserved", () => {
        expect(convertLegacySessionLimits({
            mobile_session_limit: 0, web_session_limit: null, session_limit_roles: null,
        })).toEqual({ default: { mobile: 0 } });
    });
});
