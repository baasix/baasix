/**
 * Two-Factor (TOTP + backup codes) service
 */
import * as OTPAuth from "otpauth";
import crypto from "crypto";
import argon2 from "argon2";
import type { AuthAdapter } from "../../types.js";

const TOTP_PARAMS = { algorithm: "SHA1", digits: 6, period: 30 } as const;

export function createTwoFactorService(adapter: AuthAdapter, opts: { issuer: string }) {
  const makeTotp = (secretB32: string, label: string) =>
    new OTPAuth.TOTP({
      issuer: opts.issuer,
      label,
      secret: OTPAuth.Secret.fromBase32(secretB32),
      ...TOTP_PARAMS,
    });

  return {
    async generateSetup(user: { id: string; email: string | null }) {
      const secret = new OTPAuth.Secret({ size: 20 });
      const secretB32 = secret.base32;
      const backupCodes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex"));
      const hashed = await Promise.all(backupCodes.map((c) => argon2.hash(c)));

      const existing = await adapter.findTwoFactorByUserId(user.id);
      if (existing) {
        // Re-enrollment before activation replaces the pending secret. An ACTIVE
        // enrollment must be disabled first (route enforces password check).
        await adapter.updateTwoFactor(existing.id, { secret: secretB32, backupCodes: hashed, enabled: false });
      } else {
        await adapter.createTwoFactor({ user_Id: user.id, secret: secretB32, backupCodes: hashed, enabled: false });
      }

      const otpauthUrl = makeTotp(secretB32, user.email || user.id).toString();
      return { secret: secretB32, otpauthUrl, backupCodes };
    },

    async activate(userId: string, code: string) {
      const row = await adapter.findTwoFactorByUserId(userId);
      if (!row) return false;
      const delta = makeTotp(row.secret, userId).validate({ token: code, window: 1 });
      if (delta === null) return false;
      await adapter.updateTwoFactor(row.id, { enabled: true });
      return true;
    },

    async disable(userId: string) {
      const row = await adapter.findTwoFactorByUserId(userId);
      if (row) await adapter.deleteTwoFactor(row.id);
    },

    async isEnabled(userId: string) {
      const row = await adapter.findTwoFactorByUserId(userId);
      return !!row?.enabled;
    },

    async verifyCode(userId: string, code: string) {
      const row = await adapter.findTwoFactorByUserId(userId);
      if (!row) return false;

      const delta = makeTotp(row.secret, userId).validate({ token: code, window: 1 });
      if (delta !== null) return true;

      // Backup code path — constant-shape loop, consume on match
      for (let i = 0; i < row.backupCodes.length; i++) {
        const hash = row.backupCodes[i];
        if (!hash) continue;
        if (await argon2.verify(hash, code).catch(() => false)) {
          const remaining = [...row.backupCodes];
          remaining[i] = null as any; // burned
          await adapter.updateTwoFactor(row.id, { backupCodes: remaining });
          return true;
        }
      }
      return false;
    },
  };
}
