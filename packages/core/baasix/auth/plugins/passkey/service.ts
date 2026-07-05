/**
 * Passkey (WebAuthn) service — wraps @simplewebauthn/server.
 */
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import crypto from "crypto";
import type { AuthAdapter } from "../../types.js";

export interface PasskeyConfig { rpId: string; rpName: string; origins: string[] }
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function createPasskeyService(adapter: AuthAdapter, config: PasskeyConfig) {
  const saveChallenge = async (identifier: string, challenge: string) => {
    await adapter.deleteVerificationByIdentifier(identifier);
    await adapter.createVerification({ identifier, value: challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
  };
  const takeChallenge = async (identifier: string) => {
    const row = await adapter.findVerificationByIdentifier(identifier);
    if (!row) return null;
    await adapter.deleteVerificationByIdentifier(identifier);
    return row.expiresAt >= new Date() ? row.value : null;
  };

  return {
    async registrationOptions(user: { id: string; email: string | null }) {
      const existing = await adapter.findPasskeysByUserId(user.id);
      const options = await generateRegistrationOptions({
        rpID: config.rpId,
        rpName: config.rpName,
        userName: user.email || user.id,
        attestationType: "none",
        excludeCredentials: existing.map((p: any) => ({ id: p.credentialID, transports: p.transports || undefined })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      });
      await saveChallenge(`passkey:reg:${user.id}`, options.challenge);
      return options;
    },

    async verifyRegistration(user: { id: string }, response: any, name: string | null) {
      const expectedChallenge = await takeChallenge(`passkey:reg:${user.id}`);
      if (!expectedChallenge) throw new Error("Registration challenge expired");
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
      });
      if (!verification.verified || !verification.registrationInfo) throw new Error("Passkey verification failed");
      const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;
      return adapter.createPasskey({
        user_Id: user.id,
        name,
        credentialID: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: credential.transports || null,
        aaguid: aaguid || null,
      });
    },

    async authenticationOptions() {
      const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: "preferred" });
      const challengeId = crypto.randomBytes(16).toString("hex");
      await saveChallenge(`passkey:auth:${challengeId}`, options.challenge);
      return { options, challengeId };
    },

    async verifyAuthentication(challengeId: string, response: any) {
      const expectedChallenge = await takeChallenge(`passkey:auth:${challengeId}`);
      if (!expectedChallenge) throw new Error("Authentication challenge expired");
      const passkey = await adapter.findPasskeyByCredentialId(response.id);
      if (!passkey) throw new Error("Unknown passkey");
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        credential: {
          id: passkey.credentialID,
          publicKey: Buffer.from(passkey.publicKey, "base64url"),
          counter: passkey.counter,
          transports: passkey.transports || undefined,
        },
      });
      if (!verification.verified) throw new Error("Passkey verification failed");
      await adapter.updatePasskey(passkey.id, { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() });
      return passkey; // caller loads the user via passkey.user_Id
    },
  };
}
