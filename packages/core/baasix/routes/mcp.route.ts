// @ts-nocheck
/**
 * MCP Route - Model Context Protocol HTTP endpoint
 *
 * Provides MCP server access via Streamable HTTP transport at /mcp
 * Enable via environment variable: MCP_ENABLED=true
 *
 * Authentication options (in priority order):
 * 1. X-MCP-Email + X-MCP-Password headers - Uses internal auth service to login
 * 2. Query params: ?email=...&password=... - Useful for remote MCP clients that can't set custom headers
 * 3. POST body: { email, password } - Credentials sent in request body
 * 4. Authorization header or cookie from request (auth middleware populates accountability)
 *
 * Supports both stateful (with sessions) and stateless modes.
 *
 * Note: @ts-nocheck is used because the MCP SDK types cause TypeScript
 * to hang during compilation due to complex generic type inference.
 */

import type { Express, Request, Response } from "../types/index.js";
import { randomUUID, createHash } from "crypto";
import bodyParser from "body-parser";
import env from "../utils/env.js";

// ==================== Type Definitions ====================

/**
 * MCPAccountability mirrors the shape built by the auth middleware,
 * so that ItemsService.isAdministrator() works correctly.
 */
interface MCPAccountability {
  user: {
    id: string | number;
    email?: string;
    firstName?: string;
    lastName?: string;
    isAdmin: boolean;
    role: string;
    [key: string]: any;
  } | null;
  role: {
    id: string | number;
    name: string;
    isTenantSpecific?: boolean;
    description?: string;
  } | null;
  permissions: any[];
  tenant: string | number | null;
  ipaddress: string;
  token?: string;
}

interface RequestWithAccountability extends Request {
  accountability?: any;
}

interface StreamableTransport {
  handleRequest: (req: Request, res: Response, body?: unknown) => Promise<void>;
  close: () => Promise<void>;
}

// ==================== Lazy-loaded Dependencies ====================

let StreamableHTTPServerTransport: new (options: {
  sessionIdGenerator?: (() => string) | undefined;
  onsessioninitialized?: (sessionId: string) => void;
  onsessionclosed?: (sessionId: string) => void;
}) => StreamableTransport;

let createMCPServer: () => { connect: (transport: StreamableTransport) => Promise<void>; close: () => Promise<void> };
let setMCPSession: (sessionId: string, accountability: MCPAccountability) => void;
let removeMCPSession: (sessionId: string) => void;

// Store active transports for session management
const activeTransports = new Map<string, StreamableTransport>();

// Store MCP server instance (singleton)
let mcpServer: { connect: (transport: StreamableTransport) => Promise<void>; close: () => Promise<void> } | null = null;

/**
 * Load MCP dependencies lazily
 */
async function loadMCPDependencies(): Promise<void> {
  if (!StreamableHTTPServerTransport) {
    const mcpModule = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    StreamableHTTPServerTransport = mcpModule.StreamableHTTPServerTransport;

    const mcpService = await import("../services/MCPService.js");
    createMCPServer = mcpService.createMCPServer;
    setMCPSession = mcpService.setMCPSession;
    removeMCPSession = mcpService.removeMCPSession;
  }
}

// Cache for email/password-based login (per email)
const loginCache = new Map<string, { accountability: MCPAccountability; expiry: number }>();

// ==================== OAuth 2.1 for MCP Remote Auth ====================

// In-memory stores for OAuth clients, authorization codes, and access tokens
const oauthClients = new Map<string, {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method: string;
  created_at: number;
}>();

const authorizationCodes = new Map<string, {
  client_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge?: string;
  code_challenge_method?: string;
  expires_at: number;
  accountability: MCPAccountability;
}>();

const oauthAccessTokens = new Map<string, {
  client_id: string;
  scope: string;
  expires_at: number;
  accountability: MCPAccountability;
}>();

function escapeHtml(unsafe: string): string {
  return String(unsafe || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderLoginPage(res: Response, params: {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  error?: string;
}): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Baasix - MCP Authorization</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f0f2f5; }
    .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); width: 360px; }
    h2 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    .subtitle { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; color: #333; }
    input[type="email"], input[type="password"] { width: 100%; padding: 0.5rem 0.75rem; margin-bottom: 1rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; }
    input:focus { outline: none; border-color: #0070f3; box-shadow: 0 0 0 2px rgba(0,112,243,.15); }
    button { width: 100%; padding: 0.625rem; background: #0070f3; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
    button:hover { background: #005bb5; }
    .error { background: #fef2f2; color: #dc2626; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.8125rem; margin-bottom: 1rem; }
  </style>
</head>
<body><div class="card">
  <h2>Baasix MCP</h2>
  <p class="subtitle">Sign in to authorize MCP access</p>
  ${params.error ? `<div class="error">${escapeHtml(params.error)}</div>` : ''}
  <form method="POST">
    <input type="hidden" name="client_id" value="${escapeHtml(params.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirect_uri)}">
    <input type="hidden" name="response_type" value="${escapeHtml(params.response_type)}">
    <input type="hidden" name="state" value="${escapeHtml(params.state || '')}">
    <input type="hidden" name="scope" value="${escapeHtml(params.scope || '')}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(params.code_challenge || '')}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.code_challenge_method || '')}">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" placeholder="you@example.com" required autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" placeholder="Password" required>
    <button type="submit">Sign In</button>
  </form>
</div></body></html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
}

// URL-encoded body parser for OAuth form submissions
const urlencodedParser = bodyParser.urlencoded({ extended: true });

/**
 * Login using email and password via internal auth service (no HTTP round-trip).
 * Uses getAuthInstance().signIn() directly, same as the auth route handlers.
 */
async function performLogin(email: string, password: string, cacheKey: string, ip: string): Promise<MCPAccountability | null> {
  // Check if we have a valid cached accountability for this email
  const cached = loginCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return { ...cached.accountability, ipaddress: ip };
  }

  try {
    const { getAuthInstance } = await import("./auth.route.js");
    const auth = getAuthInstance();
    if (!auth) {
      console.error("[MCP] Auth service not initialized yet");
      return null;
    }

    const result = await auth.signIn({ email, password, ipAddress: ip });
    if (!result || "twoFactorRequired" in result) {
      console.error(`[MCP] Login failed for ${email}: ${result ? "two-factor authentication is required and is not supported for MCP login" : "invalid credentials"}`);
      return null;
    }
    if (!result.user) {
      console.error(`[MCP] Login failed for ${email}: invalid credentials`);
      return null;
    }

    // Build accountability matching the shape the auth middleware produces
    const isAdmin = result.role?.name === "administrator";
    const accountability: MCPAccountability = {
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: (result.user as any).firstName,
        lastName: (result.user as any).lastName,
        isAdmin,
        role: result.role?.name || "public",
      },
      role: result.role ? {
        id: result.role.id,
        name: result.role.name,
        isTenantSpecific: result.role.isTenantSpecific,
      } : null,
      permissions: result.permissions || [],
      tenant: (result as any).tenant?.id || null,
      ipaddress: ip,
    };

    // Cache for 55 minutes (tokens typically last 1 hour)
    loginCache.set(cacheKey, {
      accountability,
      expiry: Date.now() + 55 * 60 * 1000,
    });

    // Store the JWT token so MCP tools can call routes with Bearer auth
    accountability.token = result.token;

    console.info(`[MCP] Login successful for ${email} (admin: ${isAdmin})`);
    return accountability;
  } catch (error) {
    const err = error as Error;
    console.error(`[MCP] Login failed for ${email}:`, err.message);
    loginCache.delete(cacheKey);
  }

  return null;
}

/**
 * Get accountability from request headers, query params, or body
 * Priority: 1. X-MCP-Email/Password headers, 2. Query params (email/password), 3. POST body (email/password), 4. Authorization Bearer token (auth middleware)
 */
async function getAccountability(req: RequestWithAccountability): Promise<{ accountability: MCPAccountability | null; error?: string }> {
  const ip = req.ip || "127.0.0.1";

  // Priority 1: X-MCP-Email and X-MCP-Password headers (email/password auth)
  const headerEmail = req.headers["x-mcp-email"] as string | undefined;
  const headerPassword = req.headers["x-mcp-password"] as string | undefined;

  if (headerEmail && headerPassword) {
    const result = await performLogin(headerEmail, headerPassword, `header:${headerEmail}`, ip);
    if (result) {
      return { accountability: result };
    }
    return {
      accountability: null,
      error: "Invalid email or password.",
    };
  }

  // Priority 2: Query parameters (email & password) - useful for remote MCP clients
  const queryEmail = req.query?.email as string | undefined;
  const queryPassword = req.query?.password as string | undefined;

  if (queryEmail && queryPassword) {
    const result = await performLogin(queryEmail, queryPassword, `query:${queryEmail}`, ip);
    if (result) {
      return { accountability: result };
    }
    return {
      accountability: null,
      error: "Invalid email or password.",
    };
  }

  // Priority 3: POST body (email & password) - useful for remote MCP clients sending credentials in body
  if (req.method === "POST" && req.body) {
    const bodyEmail = req.body.email as string | undefined;
    const bodyPassword = req.body.password as string | undefined;

    if (bodyEmail && bodyPassword) {
      const result = await performLogin(bodyEmail, bodyPassword, `body:${bodyEmail}`, ip);
      if (result) {
        return { accountability: result };
      }
      return {
        accountability: null,
        error: "Invalid email or password.",
      };
    }
  }

  // Priority 4: Authorization Bearer token (auth middleware already populated req.accountability)
  const authHeader = req.headers["authorization"] as string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token) {
      // Check if it's an OAuth access token from MCP OAuth flow
      const oauthToken = oauthAccessTokens.get(token);
      if (oauthToken && oauthToken.expires_at > Date.now()) {
        return { accountability: oauthToken.accountability };
      }
      if (oauthToken) {
        oauthAccessTokens.delete(token); // Clean up expired token
      }

      // req.accountability is already populated by auth middleware with the full shape:
      // { user: { id, email, isAdmin, role, ... }, role: { id, name, isTenantSpecific }, permissions, tenant, ipaddress }
      if (req.accountability?.user) {
        return {
          accountability: {
            user: req.accountability.user || null,
            role: req.accountability.role || null,
            permissions: req.accountability.permissions || [],
            tenant: req.accountability.tenant || null,
            ipaddress: ip,
            token,
          },
        };
      }
      // Token provided but auth middleware didn't populate accountability
      return {
        accountability: null,
        error: "Invalid or expired token.",
      };
    }
  }

  // No authentication - return error
  return {
    accountability: null,
    error: "Authentication required. Provide Authorization Bearer token, X-MCP-Email/X-MCP-Password headers, email/password query params, or email/password in POST body.",
  };
}

/**
 * Get or create the MCP server instance
 */
async function getMCPServer(): Promise<{ connect: (transport: StreamableTransport) => Promise<void>; close: () => Promise<void> }> {
  await loadMCPDependencies();
  if (!mcpServer) {
    mcpServer = createMCPServer();
  }
  return mcpServer;
}

const registerEndpoint = async (app: Express, _context?: unknown): Promise<void> => {
  // Check if MCP is enabled
  if (env.get("MCP_ENABLED") !== "true") {
    console.info("[MCP] MCP is disabled. Set MCP_ENABLED=true in your .env to enable the MCP endpoint.");
    return;
  }

  // Load MCP dependencies only when enabled
  await loadMCPDependencies();

  const mcpPath = env.get("MCP_PATH") || "/mcp";

  console.info(`[MCP] Registering MCP endpoint at ${mcpPath}`);

  // ==================== OAuth 2.1 Endpoints for MCP Remote Auth ====================

  const baseURL = env.get("BASE_URL") || `http://localhost:${env.get("PORT") || 4400}`;

  // OAuth Protected Resource Metadata (RFC 9728)
  app.get(`/.well-known/oauth-protected-resource${mcpPath}`, (_req: Request, res: Response) => {
    res.json({
      resource: `${baseURL}${mcpPath}`,
      authorization_servers: [baseURL],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools"],
    });
  });

  // Also serve at root path as fallback
  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json({
      resource: `${baseURL}${mcpPath}`,
      authorization_servers: [baseURL],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools"],
    });
  });

  // OAuth Authorization Server Metadata (RFC 8414)
  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.json({
      issuer: baseURL,
      authorization_endpoint: `${baseURL}${mcpPath}/oauth/authorize`,
      token_endpoint: `${baseURL}${mcpPath}/oauth/token`,
      registration_endpoint: `${baseURL}${mcpPath}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:tools"],
    });
  });

  // Dynamic Client Registration (RFC 7591)
  app.post(`${mcpPath}/oauth/register`, (req: Request, res: Response) => {
    const body = req.body;
    const client_id = randomUUID();
    const client_secret = randomUUID();

    const tokenEndpointAuthMethod = body.token_endpoint_auth_method || "client_secret_basic";
    const isPublic = tokenEndpointAuthMethod === "none";

    oauthClients.set(client_id, {
      client_id,
      client_secret: isPublic ? "" : client_secret,
      redirect_uris: body.redirect_uris || [],
      client_name: body.client_name,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      created_at: Date.now(),
    });

    const response: Record<string, any> = {
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...body,
    };

    if (!isPublic) {
      response.client_secret = client_secret;
      response.client_secret_expires_at = 0;
    }

    console.info(`[MCP OAuth] Client registered: ${client_id} (${body.client_name || 'unnamed'})`);
    res.status(201).json(response);
  });

  // Authorization Endpoint - GET (show login form)
  app.get(`${mcpPath}/oauth/authorize`, (req: Request, res: Response) => {
    const { client_id, redirect_uri, response_type, state, scope, code_challenge, code_challenge_method } = req.query as Record<string, string>;

    if (response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }

    const client = oauthClients.get(client_id);
    if (!client) {
      res.status(400).json({ error: "invalid_client", error_description: "Unknown client_id" });
      return;
    }

    if (redirect_uri && !client.redirect_uris.includes(redirect_uri)) {
      res.status(400).json({ error: "invalid_request", error_description: "Invalid redirect_uri" });
      return;
    }

    renderLoginPage(res, { client_id, redirect_uri, response_type, state, scope, code_challenge, code_challenge_method });
  });

  // Authorization Endpoint - POST (handle login form submission)
  app.post(`${mcpPath}/oauth/authorize`, urlencodedParser, async (req: Request, res: Response) => {
    const { email, password, client_id, redirect_uri, state, scope, code_challenge, code_challenge_method } = req.body;

    const client = oauthClients.get(client_id);
    if (!client) {
      renderLoginPage(res, { client_id, redirect_uri, response_type: "code", state, scope, code_challenge, code_challenge_method, error: "Unknown client" });
      return;
    }

    if (redirect_uri && !client.redirect_uris.includes(redirect_uri)) {
      renderLoginPage(res, { client_id, redirect_uri, response_type: "code", state, scope, code_challenge, code_challenge_method, error: "Invalid redirect URI" });
      return;
    }

    const ip = (req as any).ip || "127.0.0.1";
    const accountability = await performLogin(email, password, `oauth:${email}`, ip);

    if (!accountability) {
      renderLoginPage(res, { client_id, redirect_uri, response_type: "code", state, scope, code_challenge, code_challenge_method, error: "Invalid email or password" });
      return;
    }

    // Generate authorization code
    const code = randomUUID();
    authorizationCodes.set(code, {
      client_id,
      redirect_uri,
      scope: scope || "mcp:tools",
      code_challenge,
      code_challenge_method,
      expires_at: Date.now() + 10 * 60 * 1000,
      accountability,
    });

    const redirectURL = new URL(redirect_uri);
    redirectURL.searchParams.set("code", code);
    if (state) redirectURL.searchParams.set("state", state);

    console.info(`[MCP OAuth] Authorization code issued for user ${accountability.user?.email}`);
    res.redirect(302, redirectURL.toString());
  });

  // Token Endpoint
  app.post(`${mcpPath}/oauth/token`, urlencodedParser, async (req: Request, res: Response) => {
    const { grant_type, code, redirect_uri, code_verifier, client_id: body_client_id, client_secret: body_client_secret } = req.body;

    let client_id = body_client_id;
    let client_secret = body_client_secret;

    // Parse Basic auth header
    const tokenAuthHeader = req.headers["authorization"] as string;
    if (tokenAuthHeader?.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(tokenAuthHeader.substring(6), "base64").toString();
        const colonIdx = decoded.indexOf(":");
        if (colonIdx === -1) throw new Error("Invalid format");
        client_id = decodeURIComponent(decoded.substring(0, colonIdx));
        client_secret = decodeURIComponent(decoded.substring(colonIdx + 1));
      } catch {
        res.status(401).json({ error: "invalid_client", error_description: "Invalid Basic auth header" });
        return;
      }
    }

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    if (!code) {
      res.status(400).json({ error: "invalid_request", error_description: "code is required" });
      return;
    }

    const authCode = authorizationCodes.get(code);
    if (!authCode) {
      res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" });
      return;
    }

    // Delete the code (single use)
    authorizationCodes.delete(code);

    if (authCode.expires_at < Date.now()) {
      res.status(400).json({ error: "invalid_grant", error_description: "Authorization code expired" });
      return;
    }

    if (authCode.client_id !== client_id) {
      res.status(400).json({ error: "invalid_client", error_description: "client_id mismatch" });
      return;
    }

    if (authCode.redirect_uri && authCode.redirect_uri !== redirect_uri) {
      res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
      return;
    }

    // Validate client credentials for confidential clients
    const client = oauthClients.get(client_id);
    if (client && client.token_endpoint_auth_method !== "none") {
      if (client.client_secret && client.client_secret !== client_secret) {
        res.status(401).json({ error: "invalid_client", error_description: "Invalid client credentials" });
        return;
      }
    }

    // PKCE verification
    if (authCode.code_challenge) {
      if (!code_verifier) {
        res.status(400).json({ error: "invalid_request", error_description: "code_verifier is required" });
        return;
      }

      let challenge: string;
      if (authCode.code_challenge_method === "S256") {
        challenge = createHash("sha256").update(code_verifier).digest("base64url");
      } else {
        challenge = code_verifier;
      }

      if (challenge !== authCode.code_challenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
    }

    // Generate access token
    const access_token = randomUUID();
    oauthAccessTokens.set(access_token, {
      client_id,
      scope: authCode.scope,
      expires_at: Date.now() + 60 * 60 * 1000, // 1 hour
      accountability: authCode.accountability,
    });

    // Clean up expired tokens periodically
    if (oauthAccessTokens.size % 100 === 0) {
      const now = Date.now();
      for (const [key, val] of oauthAccessTokens) {
        if (val.expires_at < now) oauthAccessTokens.delete(key);
      }
    }

    console.info(`[MCP OAuth] Access token issued for client ${client_id}`);

    res.json({
      access_token,
      token_type: "Bearer",
      expires_in: 3600,
      scope: authCode.scope,
    });
  });

  // ==================== End OAuth 2.1 Endpoints ====================

  /**
   * Handle MCP requests via Streamable HTTP transport
   * Supports both POST (for requests) and GET (for SSE notifications)
   */
  app.all(mcpPath, async (req: Request, res: Response) => {
    try {
      // Authenticate first
      const { accountability, error: authError } = await getAccountability(req as RequestWithAccountability);
      if (!accountability) {
        res.status(401).json({ error: authError });
        return;
      }

      // Get or create session ID from header
      let sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // Check if we have an existing transport for this session
        let transport = sessionId ? activeTransports.get(sessionId) : undefined;

        if (!transport) {
          // Create new session and transport for stateful mode
          sessionId = randomUUID();

          // Capture accountability for closure
          const sessionAccountability = accountability;

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId!,
            onsessioninitialized: (sid: string) => {
              console.info(`[MCP] Session initialized: ${sid} (user: ${sessionAccountability.user?.id || 'null'}, role: ${sessionAccountability.role?.name || 'null'}, admin: ${sessionAccountability.user?.isAdmin || false})`);
              setMCPSession(sid, sessionAccountability);
            },
            onsessionclosed: (sid: string) => {
              console.info(`[MCP] Session closed: ${sid}`);
              activeTransports.delete(sid);
              removeMCPSession(sid);
            },
          });

          // Store the transport for this session
          activeTransports.set(sessionId, transport);

          // Connect MCP server to this transport
          const server = await getMCPServer();
          await server.connect(transport);
        } else {
          // Existing session — refresh the accountability (and token) so that
          // tool handlers use the latest credentials instead of the potentially
          // expired ones that were stored when the session was first created.
          setMCPSession(sessionId!, accountability);
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
      } else if (req.method === "GET") {
        // GET requests are for SSE streams (server-initiated notifications)
        if (!sessionId) {
          res.status(400).json({
            error: "Missing mcp-session-id header for SSE connection",
          });
          return;
        }

        const transport = activeTransports.get(sessionId);
        if (!transport) {
          res.status(404).json({
            error: "Session not found. Initialize with POST first.",
          });
          return;
        }

        // Handle SSE connection for server-initiated messages
        await transport.handleRequest(req, res);
      } else if (req.method === "DELETE") {
        // DELETE to close a session (idempotent - always 200)
        if (sessionId && activeTransports.has(sessionId)) {
          const transport = activeTransports.get(sessionId);
          if (transport) {
            await transport.close();
          }
          activeTransports.delete(sessionId);
          removeMCPSession(sessionId);
          console.info(`[MCP] Session deleted: ${sessionId}`);
        }
        res.status(200).json({ message: "Session closed" });
      } else if (req.method === "OPTIONS") {
        // Handle CORS preflight
        res.status(204).end();
      } else {
        res.status(405).json({
          error: "Method not allowed. Use POST for requests, GET for SSE, DELETE to close session.",
        });
      }
    } catch (error) {
      const err = error as Error;
      console.error("[MCP] Error handling request:", err);

      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal server error",
          message: err.message,
        });
      }
    }
  });

  /**
   * Stateless MCP endpoint (no session management)
   * Useful for simple request/response interactions
   */
  app.post(`${mcpPath}/stateless`, async (req: Request, res: Response) => {
    try {
      // Authenticate first
      const { accountability, error: authError } = await getAccountability(req as RequestWithAccountability);
      if (!accountability) {
        res.status(401).json({ error: authError });
        return;
      }

      // Create a one-time transport for this request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
      });

      // Create a fresh server instance for stateless requests
      const server = createMCPServer();

      // Use a temporary session ID for this request
      const tempSessionId = randomUUID();
      setMCPSession(tempSessionId, accountability);

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // Cleanup
      removeMCPSession(tempSessionId);
      await server.close();
    } catch (error) {
      const err = error as Error;
      console.error("[MCP] Error handling stateless request:", err);

      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal server error",
          message: err.message,
        });
      }
    }
  });

  /**
   * MCP info endpoint - provides server capabilities
   */
  app.get(`${mcpPath}/info`, (_req: Request, res: Response) => {
    res.json({
      name: "baasix-mcp-server",
      version: "0.1.0",
      description: "Baasix MCP Server - Direct API access via Model Context Protocol",
      transport: "streamable-http",
      endpoints: {
        main: mcpPath,
        stateless: `${mcpPath}/stateless`,
        info: `${mcpPath}/info`,
      },
      capabilities: {
        tools: true,
        resources: true,
        prompts: false,
      },
      activeSessions: activeTransports.size,
    });
  });

  console.info(`[MCP] MCP endpoint registered successfully`);
};

export default {
  id: "mcp",
  handler: registerEndpoint,
};
