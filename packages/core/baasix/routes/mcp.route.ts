/**
 * MCP Route - Model Context Protocol HTTP endpoint
 * 
 * Provides MCP server access via Streamable HTTP transport at /mcp
 * Enable via environment variable: MCP_ENABLED=true
 * 
 * Authentication options (in priority order):
 * 1. MCP_AUTH_TOKEN - Static token for MCP access
 * 2. MCP_EMAIL + MCP_PASSWORD - Auto-login and reuse token
 * 3. Authorization header or cookie from request (like normal API calls)
 * 
 * Supports both stateful (with sessions) and stateless modes.
 */

import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import env from "../utils/env.js";

// Lazy-load MCP dependencies only when enabled
let StreamableHTTPServerTransport: any = null;
let createMCPServer: any = null;
let setMCPSession: any = null;
let removeMCPSession: any = null;

// Store active transports for session management
const activeTransports = new Map<string, any>();

// Store MCP server instance (singleton)
let mcpServer: any = null;

/**
 * Load MCP dependencies lazily
 */
async function loadMCPDependencies() {
  if (!StreamableHTTPServerTransport) {
    const mcpModule = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    StreamableHTTPServerTransport = mcpModule.StreamableHTTPServerTransport;
    
    const mcpService = await import("../services/MCPService.js");
    createMCPServer = mcpService.createMCPServer;
    setMCPSession = mcpService.setMCPSession;
    removeMCPSession = mcpService.removeMCPSession;
  }
}

// Cache for header-based login (per email)
const headerLoginCache = new Map<string, { token: string; expiry: number; accountability: any }>();

/**
 * Login using email and password from headers
 * Returns accountability object or null if failed
 */
async function performLogin(email: string, password: string, cacheKey: string): Promise<any> {
  // Check if we have a valid cached token for this email
  const cached = headerLoginCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry && cached.accountability) {
    return cached.accountability;
  }

  try {
    // Import auth utilities
    const { default: axios } = await import("axios");
    const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
    
    const response = await axios.post(`${baseUrl}/auth/login`, {
      email,
      password,
    });

    if (response.data?.token) {
      // Extract accountability from token response
      const accountability = {
        user: response.data.user?.id || null,
        role: response.data.user?.role?.name || response.data.user?.role_Id || null,
        admin: response.data.user?.role?.name === 'administrator',
        ip: '127.0.0.1'
      };
      
      // Cache for 55 minutes (tokens typically last 1 hour)
      headerLoginCache.set(cacheKey, {
        token: response.data.token,
        expiry: Date.now() + 55 * 60 * 1000,
        accountability
      });
      
      console.info(`[MCP] Login successful for ${email}`);
      return accountability;
    }
  } catch (error: any) {
    console.error(`[MCP] Login failed for ${email}:`, error.message);
    headerLoginCache.delete(cacheKey);
  }
  
  return null;
}

/**
 * Get accountability from request headers
 * Priority: 1. X-MCP-Email/Password headers, 2. Authorization Bearer token
 */
async function getAccountability(req: Request): Promise<{ accountability: any; error?: string }> {
  // Priority 1: X-MCP-Email and X-MCP-Password headers (email/password auth)
  // Check this first since token header might be empty when using email/password
  const headerEmail = req.headers["x-mcp-email"] as string | undefined;
  const headerPassword = req.headers["x-mcp-password"] as string | undefined;
  
  if (headerEmail && headerPassword) {
    const result = await performLogin(headerEmail, headerPassword, `header:${headerEmail}`);
    if (result) {
      return { accountability: { ...result, ip: req.ip || '127.0.0.1' } };
    }
    return {
      accountability: null,
      error: "Invalid email or password."
    };
  }

  // Priority 2: Authorization Bearer token (direct token auth)
  const authHeader = req.headers["authorization"] as string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token) {
      // Use request's accountability (populated by authMiddleware from Bearer token)
      if ((req as any).accountability?.user || (req as any).accountability?.role) {
        return {
          accountability: {
            user: (req as any).accountability.user,
            role: (req as any).accountability.role,
            admin: (req as any).accountability.admin || false,
            ip: req.ip || '127.0.0.1'
          }
        };
      }
      // Token provided but auth middleware didn't populate accountability
      return {
        accountability: null,
        error: "Invalid or expired token."
      };
    }
  }

  // No authentication - return error
  return {
    accountability: null,
    error: "Authentication required. Provide Authorization Bearer token OR X-MCP-Email/X-MCP-Password headers."
  };
}

/**
 * Get or create the MCP server instance
 */
async function getMCPServer(): Promise<any> {
  await loadMCPDependencies();
  if (!mcpServer) {
    mcpServer = createMCPServer();
  }
  return mcpServer;
}

const registerEndpoint = async (app: Express, _context?: any) => {
  // Check if MCP is enabled
  if (env.get("MCP_ENABLED") !== "true") {
    // Don't log when disabled - no need to inform about disabled feature
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
      const { accountability, error: authError } = await getAccountability(req);
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
              console.info(`[MCP] Session initialized: ${sid} (user: ${sessionAccountability.user}, role: ${sessionAccountability.role})`);
              setMCPSession(sid, sessionAccountability);
            },
            onsessionclosed: (sid: string) => {
              console.info(`[MCP] Session closed: ${sid}`);
              activeTransports.delete(sid);
              removeMCPSession(sid);
            }
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
            error: "Missing mcp-session-id header for SSE connection" 
          });
          return;
        }

        const transport = activeTransports.get(sessionId);
        if (!transport) {
          res.status(404).json({ 
            error: "Session not found. Initialize with POST first." 
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
          error: "Method not allowed. Use POST for requests, GET for SSE, DELETE to close session." 
        });
      }
    } catch (error: any) {
      console.error("[MCP] Error handling request:", error);
      
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Internal server error",
          message: error.message 
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
      const { accountability, error: authError } = await getAccountability(req);
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
      
    } catch (error: any) {
      console.error("[MCP] Error handling stateless request:", error);
      
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Internal server error",
          message: error.message 
        });
      }
    }
  });

  /**
   * MCP info endpoint - provides server capabilities
   */
  app.get(`${mcpPath}/info`, (req: Request, res: Response) => {
    res.json({
      name: "baasix-mcp-server",
      version: "0.1.0",
      description: "Baasix MCP Server - Direct API access via Model Context Protocol",
      transport: "streamable-http",
      endpoints: {
        main: mcpPath,
        stateless: `${mcpPath}/stateless`,
        info: `${mcpPath}/info`
      },
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      },
      activeSessions: activeTransports.size
    });
  });

  console.info(`[MCP] MCP endpoint registered successfully`);
};

export default {
  id: "mcp",
  handler: registerEndpoint,
};
