/**
 * Public auth-methods discovery. Populated once at auth-route registration
 * from the ACTUALLY constructed auth instance, so it can never disagree
 * with what the server accepts.
 */
export interface AuthMethodsInfo {
  registration: boolean;
  emailPassword: boolean;
  magicLink: boolean;
  passkey: boolean;
  twoFactor: boolean;
  socialProviders: string[];
}

let current: AuthMethodsInfo = {
  registration: false,
  emailPassword: false,
  magicLink: false,
  passkey: false,
  twoFactor: false,
  socialProviders: [],
};

export function setAuthMethodsInfo(info: AuthMethodsInfo): void {
  current = info;
}

export function getAuthMethodsInfo(): AuthMethodsInfo {
  return current;
}
