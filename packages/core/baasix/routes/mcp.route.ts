// @ts-nocheck
/**
 * MCP Route - Model Context Protocol HTTP endpoint
 *
 * Provides MCP server access via Streamable HTTP transport at /mcp
 * Enable via environment variable: MCP_ENABLED=true
 *
 * Authentication options (in priority order):
 * 1. X-MCP-Email + X-MCP-Password headers - Uses internal auth service to login
 * 2. Authorization header or cookie from request (auth middleware populates accountability)
 *
 * Supports both stateful (with sessions) and stateless modes.
 *
 * Note: @ts-nocheck is used because the MCP SDK types cause TypeScript
 * to hang during compilation due to complex generic type inference.
 */

import type { Express, Request, Response } from "../types/index.js";
import { randomUUID } from "crypto";
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
    if (!result || !result.user) {
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
 * Get accountability from request headers
 * Priority: 1. X-MCP-Email/Password headers, 2. Authorization Bearer token (auth middleware)
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

  // Priority 2: Authorization Bearer token (auth middleware already populated req.accountability)
  const authHeader = req.headers["authorization"] as string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token) {
      // req.accountability is already populated by auth middleware with the full shape:
      // { user: { id, email, isAdmin, role, ... }, role: { id, name, isTenantSpecific }, permissions, tenant, ipaddress }
      if (req.accountability?.user || req.accountability?.role) {
        return {
          accountability: {
            user: req.accountability.user || null,
            role: req.accountability.role || null,
            permissions: req.accountability.permissions || [],
            tenant: req.accountability.tenant || null,
            ipaddress: ip,
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
    error: "Authentication required. Provide Authorization Bearer token OR X-MCP-Email/X-MCP-Password headers.",
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
        // DELETE to close a session
        if (sessionId && activeTransports.has(sessionId)) {
          const transport = activeTransports.get(sessionId);
          if (transport) {
            await transport.close();
          }
          activeTransports.delete(sessionId);
          removeMCPSession(sessionId);
          res.status(200).json({ message: "Session closed" });
        } else {
          res.status(404).json({ error: "Session not found" });
        }
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
        resources: false,
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
