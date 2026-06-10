import env from "../utils/env.js";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { getUserRolesPermissionsAndTenant, getJwtSecret, JWT_ALGORITHM } from "../utils/auth.js";
import fieldUtils from "../utils/fieldUtils.js";
import { permissionService } from "./PermissionService.js";
import settingsService from "./SettingsService.js";
import { APIError } from "../utils/errorHandler.js";
import type { Server as HTTPServer } from "http";
import type { Socket } from "socket.io";
import type { UserInfo, SocketWithAuth } from '../types/index.js';

// --- A12 row-level scoping: pure decision helpers (exported for testing) ---

/**
 * True if a read permission filter imposes any row restriction (flat `conditions`
 * or nested `relConditions`). When false, the role can read the whole collection,
 * so a broadcast can be delivered without a per-record DB check (fast path).
 */
export function hasReadRestrictions(filter: { conditions?: any; relConditions?: any } | null | undefined): boolean {
  const hasConditions = !!filter?.conditions && Object.keys(filter.conditions).length > 0;
  const hasRelConditions = !!filter?.relConditions && Object.keys(filter.relConditions).length > 0;
  return hasConditions || hasRelConditions;
}

/**
 * True only if EVERY changed id is present in the set of ids the subscriber may
 * actually read (the result of a permission-scoped existence query). Fails closed:
 * an empty visible set with non-empty ids → false.
 */
export function allIdsVisible(changedIds: any[], visibleIds: any[]): boolean {
  if (changedIds.length === 0) return true;
  const visible = new Set(visibleIds.map((v) => String(v)));
  return changedIds.every((id) => visible.has(String(id)));
}

// Type for custom message handler callback
export type CustomMessageHandler = (
  socket: SocketWithAuth,
  data: any,
  callback?: (response: any) => void
) => void | Promise<void>;

// Type for room join/leave validator
export type RoomValidator = (
  socket: SocketWithAuth,
  roomName: string
) => boolean | Promise<boolean>;

class SocketService {
  private io: Server | null = null;
  private userSockets: Map<string | number, Set<Socket>> = new Map();
  private initialized: boolean = false;
  private redisPublisher: Redis | null = null;
  private redisSubscriber: Redis | null = null;
  
  // Custom room management
  // roomName -> Map<socketId, memberMeta>  (in-memory fallback)
  private customRooms: Map<string, Map<string, Record<string, any>>> = new Map();
  private roomCreators: Map<string, string> = new Map(); // roomName -> current creator's socketId
  private roomOriginalCreators: Map<string, string | number> = new Map(); // roomName -> original creator's userId (persistent)
  private socketIdToUserId: Map<string, string | number> = new Map(); // socketId -> userId (reverse lookup)
  private customMessageHandlers: Map<string, CustomMessageHandler> = new Map();
  private roomValidators: Map<string, RoomValidator> = new Map();

  // Message history per room — capped at ROOM_HISTORY_LIMIT entries
  // Cleared automatically when the room is destroyed (last member leaves)
  private static readonly ROOM_HISTORY_LIMIT = 200;
  private roomMessageHistory: Map<string, Array<{
    event: string;
    payload: any;
    sender: { userId: string | number; socketId: string };
    timestamp: string;
  }>> = new Map();

  // ==========================================
  // Redis-aware room storage helpers
  // ==========================================

  private get useRedis(): boolean {
    return !!(this.redisPublisher && this.redisSubscriber);
  }

  /** Add / update a member in the room's member store */
  private async rRoomMemberSet(roomName: string, socketId: string, meta: Record<string, any>): Promise<void> {
    if (this.useRedis) {
      await this.redisPublisher!.hset(`room:${roomName}:members`, socketId, JSON.stringify(meta));
    } else {
      if (!this.customRooms.has(roomName)) this.customRooms.set(roomName, new Map());
      this.customRooms.get(roomName)!.set(socketId, meta);
    }
  }

  /** Remove a member from the room's member store */
  private async rRoomMemberDel(roomName: string, socketId: string): Promise<void> {
    if (this.useRedis) {
      await this.redisPublisher!.hdel(`room:${roomName}:members`, socketId);
    } else {
      this.customRooms.get(roomName)?.delete(socketId);
    }
  }

  /** Check if a socket is in a room */
  private async rRoomMemberHas(roomName: string, socketId: string): Promise<boolean> {
    if (this.useRedis) {
      return (await this.redisPublisher!.hexists(`room:${roomName}:members`, socketId)) === 1;
    }
    return this.customRooms.get(roomName)?.has(socketId) ?? false;
  }

  /** Get all members of a room as Map<socketId, meta> */
  private async rRoomMembersAll(roomName: string): Promise<Map<string, Record<string, any>> | null> {
    if (this.useRedis) {
      const raw = await this.redisPublisher!.hgetall(`room:${roomName}:members`);
      if (!raw || Object.keys(raw).length === 0) return null;
      const m = new Map<string, Record<string, any>>();
      for (const [k, v] of Object.entries(raw)) m.set(k, JSON.parse(v));
      return m;
    }
    return this.customRooms.get(roomName) ?? null;
  }

  /** Number of members in a room */
  private async rRoomMemberCount(roomName: string): Promise<number> {
    if (this.useRedis) {
      return await this.redisPublisher!.hlen(`room:${roomName}:members`);
    }
    return this.customRooms.get(roomName)?.size ?? 0;
  }

  /** Delete the entire room (all member keys + creator keys + history) */
  private async rRoomDestroy(roomName: string): Promise<void> {
    if (this.useRedis) {
      await this.redisPublisher!.del(
        `room:${roomName}:members`,
        `room:${roomName}:creator`,
        `room:${roomName}:original_creator`,
        `room:${roomName}:history`,
      );
    } else {
      this.customRooms.delete(roomName);
      this.roomCreators.delete(roomName);
      this.roomOriginalCreators.delete(roomName);
      this.roomMessageHistory.delete(roomName);
    }
  }

  /** Get current creator socketId */
  private async rCreatorGet(roomName: string): Promise<string | null> {
    if (this.useRedis) return await this.redisPublisher!.get(`room:${roomName}:creator`);
    return this.roomCreators.get(roomName) ?? null;
  }

  /** Set current creator socketId */
  private async rCreatorSet(roomName: string, socketId: string): Promise<void> {
    if (this.useRedis) await this.redisPublisher!.set(`room:${roomName}:creator`, socketId);
    else this.roomCreators.set(roomName, socketId);
  }

  /** Delete current creator entry */
  private async rCreatorDel(roomName: string): Promise<void> {
    if (this.useRedis) await this.redisPublisher!.del(`room:${roomName}:creator`);
    else this.roomCreators.delete(roomName);
  }

  /** Get original creator userId */
  private async rOriginalCreatorGet(roomName: string): Promise<string | null> {
    if (this.useRedis) return await this.redisPublisher!.get(`room:${roomName}:original_creator`);
    const v = this.roomOriginalCreators.get(roomName);
    return v !== undefined ? String(v) : null;
  }

  /** Set original creator userId (only set once — NX) */
  private async rOriginalCreatorSet(roomName: string, userId: string | number): Promise<void> {
    if (this.useRedis) await this.redisPublisher!.setnx(`room:${roomName}:original_creator`, String(userId));
    else if (!this.roomOriginalCreators.has(roomName)) this.roomOriginalCreators.set(roomName, userId);
  }

  /** Append a message to history, trimming to ROOM_HISTORY_LIMIT */
  private async rHistoryPush(roomName: string, record: object): Promise<void> {
    if (this.useRedis) {
      const key = `room:${roomName}:history`;
      await this.redisPublisher!.rpush(key, JSON.stringify(record));
      await this.redisPublisher!.ltrim(key, -SocketService.ROOM_HISTORY_LIMIT, -1);
    } else {
      if (!this.roomMessageHistory.has(roomName)) this.roomMessageHistory.set(roomName, []);
      const h = this.roomMessageHistory.get(roomName)!;
      h.push(record as any);
      if (h.length > SocketService.ROOM_HISTORY_LIMIT) h.shift();
    }
  }

  /** Fetch all history entries for a room */
  private async rHistoryGet(roomName: string): Promise<any[]> {
    if (this.useRedis) {
      const items = await this.redisPublisher!.lrange(`room:${roomName}:history`, 0, -1);
      return items.map((i) => JSON.parse(i));
    }
    return this.roomMessageHistory.get(roomName) ?? [];
  }

  constructor() {
    console.info("Socket Service instance created");
  }

  async initialize(server: HTTPServer): Promise<void> {
    if (this.initialized) {
      console.warn("Socket.IO service already initialized");
      return;
    }

    // Get dynamic CORS origins for socket
    const getSocketCorsOrigins = async (): Promise<string | string[]> => {
      try {
        const staticOrigins = env.get("SOCKET_CORS_ENABLED_ORIGINS")?.split(",").map(o => o.trim()) || [];
        const dynamicOrigins = await settingsService.getAllSettingsUrls();
        const allOrigins = [...new Set([...staticOrigins, ...dynamicOrigins])];
        console.info(`Socket CORS origins: ${allOrigins.length} total (${staticOrigins.length} static + ${dynamicOrigins.length} dynamic)`);
        return allOrigins.length > 0 ? allOrigins : "*";
      } catch (error) {
        console.error("Error getting socket CORS origins:", error);
        return env.get("SOCKET_CORS_ENABLED_ORIGINS")?.split(",") || "*";
      }
    };

    this.io = new Server(server, {
      cors: {
        origin: await getSocketCorsOrigins(),
        methods: ["GET", "POST", "PATCH", "DELETE"],
        credentials: true,
      },
      path: env.get("SOCKET_PATH") || "/realtime",
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Initialize Redis adapter if enabled
    if (env.get("SOCKET_REDIS_ENABLED") === "true") {
      await this.initializeRedisAdapter();
    }

    // Authentication middleware
    this.io.use(this.authMiddleware.bind(this));

    this.io.on("connection", this.handleConnection.bind(this));
    this.initialized = true;
    console.info(
      "Socket.IO server initialized",
      env.get("SOCKET_REDIS_ENABLED") === "true" ? "with Redis adapter" : "with in-memory adapter"
    );
  }

  async initializeRedisAdapter(): Promise<void> {
    try {
      const redisUrl = env.get("SOCKET_REDIS_URL");
      if (!redisUrl) {
        throw new Error("SOCKET_REDIS_URL is required when Redis adapter is enabled");
      }

      // Create Redis clients for pub/sub
      this.redisPublisher = new Redis(redisUrl, {
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      this.redisSubscriber = new Redis(redisUrl, {
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      // Handle Redis connection errors
      this.redisPublisher.on("error", (error) => {
        console.error("Redis Publisher Error:", error);
      });

      this.redisSubscriber.on("error", (error) => {
        console.error("Redis Subscriber Error:", error);
      });

      // Create and set up Redis adapter
      const adapter = createAdapter(this.redisPublisher, this.redisSubscriber, {
        key: env.get("SOCKET_REDIS_KEY") || "socket.io",
        publishOnSpecificResponseChannel: true,
      });

      this.io!.adapter(adapter);

      console.info("Redis adapter initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Redis adapter:", error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.redisPublisher) {
      await this.redisPublisher.quit();
    }
    if (this.redisSubscriber) {
      await this.redisSubscriber.quit();
    }
    if (this.io) {
      await new Promise<void>((resolve) => this.io!.close(() => resolve()));
    }
    this.initialized = false;
  }

  async authMiddleware(socket: SocketWithAuth, next: (err?: Error) => void): Promise<void> {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token) {
        throw new APIError("No authentication token provided", 401);
      }

      const decoded: any = jwt.verify(token as string, getJwtSecret(), { algorithms: [JWT_ALGORITHM] });
      const { user, role, permissions, tenant } = await this.authenticateUser(decoded);

      // Attach user info to socket
      socket.userId = user.id;
      socket.userRole = role;
      socket.userPermissions = permissions;
      socket.userTenant = tenant;

      next();
    } catch (error: any) {
      next(new Error(error.message));
    }
  }

  async authenticateUser(decoded: any): Promise<UserInfo> {
    const { role, permissions, tenant } = await getUserRolesPermissionsAndTenant(decoded.id, decoded.tenant_Id);

    return {
      user: { id: decoded.id },
      role,
      permissions,
      tenant,
    };
  }

  async handleConnection(socket: SocketWithAuth): Promise<void> {
    try {
      // Add to userSockets map
      if (!this.userSockets.has(socket.userId!)) {
        this.userSockets.set(socket.userId!, new Set());
      }
      this.userSockets.get(socket.userId!)!.add(socket);

      // Register reverse lookup: socketId -> userId
      this.socketIdToUserId.set(socket.id, socket.userId!);

      // Join tenant room if applicable
      if (socket.userTenant) {
        socket.join(`tenant:${socket.userTenant.id}`);
      }

      // Handle collection subscriptions
      socket.on("subscribe", async (data: any, callback?: (response: any) => void) => {
        try {
          await this.handleSubscribe(socket, data);
          console.log(`User ${socket.userId} subscribed to ${data.collection}`);
          callback?.({ status: "success" });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle unsubscribe
      socket.on("unsubscribe", (data: any, callback?: (response: any) => void) => {
        try {
          this.handleUnsubscribe(socket, data);
          callback?.({ status: "success" });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle workflow execution room joins — gated by ownership/tenant.
      // Previously any authenticated socket could join any execution:<id> room and
      // receive another user's (or tenant's) execution outputs.
      socket.on("workflow:execution:join", async ({ executionId }: { executionId: string | number }) => {
        try {
          const allowed = await this.canJoinExecutionRoom(socket, executionId);
          if (!allowed) {
            socket.emit("workflow:execution:error", { executionId, message: "Not authorized for this execution" });
            return;
          }
          socket.join(`execution:${executionId}`);
          console.log(`User ${socket.userId} joined execution room: ${executionId}`);
        } catch (error: any) {
          socket.emit("workflow:execution:error", { executionId, message: "Failed to join execution room" });
        }
      });

      // Handle custom room join
      socket.on("room:join", async (data: { room: string; metadata?: Record<string, any> }, callback?: (response: any) => void) => {
        try {
          await this.handleRoomJoin(socket, data.room, data.metadata);
          const history = await this.rHistoryGet(data.room);
          callback?.({ status: "success", room: data.room, history });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle custom room leave
      socket.on("room:leave", async (data: { room: string }, callback?: (response: any) => void) => {
        try {
          await this.handleRoomLeave(socket, data.room);
          callback?.({ status: "success", room: data.room });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle custom room message (client -> server -> room)
      socket.on("room:message", async (data: { room: string; event: string; payload: any; history?: boolean }, callback?: (response: any) => void) => {
        try {
          await this.handleRoomMessage(socket, data.room, data.event, data.payload, data.history ?? true);
          callback?.({ status: "success" });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle room members request — any room member can call this
      socket.on("room:members", async (data: { room: string }, callback?: (response: any) => void) => {
        try {
          const members = await this.handleRoomMembers(socket, data.room);
          callback?.({ status: "success", members });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle kick request — only the room creator may kick
      socket.on("room:kick", async (data: { room: string; userId: string | number }, callback?: (response: any) => void) => {
        try {
          await this.handleRoomKick(socket, data.room, data.userId);
          callback?.({ status: "success" });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle room list request — returns all rooms (optionally filtered by prefix)
      socket.on("room:list", async (data: { prefix?: string } = {}, callback?: (response: any) => void) => {
        try {
          const allRooms = await this.getCustomRooms();
          const prefix = data?.prefix ?? "";
          const rooms: Array<{ name: string; memberCount: number }> = [];
          for (const [name, memberCount] of allRooms.entries()) {
            if (!prefix || name.startsWith(prefix)) {
              rooms.push({ name, memberCount });
            }
          }
          callback?.({ status: "success", rooms });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle custom events with registered handlers
      socket.on("custom", async (data: { event: string; payload: any }, callback?: (response: any) => void) => {
        try {
          await this.handleCustomEvent(socket, data.event, data.payload, callback);
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });

      // Send initial connection success
      socket.emit("connected", {
        userId: socket.userId,
        tenant: socket.userTenant,
      });
    } catch (error) {
      console.error("Socket connection error:", error);
      socket.disconnect(true);
    }
  }

  async handleSubscribe(socket: SocketWithAuth, { collection }: { collection: string }): Promise<void> {
    if (socket.userRole.name !== "administrator") {
      // Check permission
      const hasAccess = await this.checkCollectionAccess(socket, collection);
      if (!hasAccess) {
        throw new APIError("No permission to subscribe to this collection", 403);
      }
    }

    // Join the collection room
    const roomName = this.getCollectionRoom(collection, socket.userTenant?.id);
    socket.join(roomName);

    // Join specific tenant room for this collection if applicable
    if (socket.userTenant) {
      socket.join(`${roomName}:tenant:${socket.userTenant.id}`);
    }
  }

  handleUnsubscribe(socket: SocketWithAuth, { collection }: { collection: string }): void {
    const roomName = this.getCollectionRoom(collection, socket.userTenant?.id);
    socket.leave(roomName);

    if (socket.userTenant) {
      socket.leave(`${roomName}:tenant:${socket.userTenant.id}`);
    }
  }

  handleDisconnect(socket: SocketWithAuth): void {
    if (socket.userId && this.userSockets.has(socket.userId)) {
      this.userSockets.get(socket.userId)!.delete(socket);
      if (this.userSockets.get(socket.userId)!.size === 0) {
        this.userSockets.delete(socket.userId);
      }
    }

    // Clean up reverse socket ID lookup
    this.socketIdToUserId.delete(socket.id);

    // Async cleanup — fire-and-forget (disconnect handler can't be async in Socket.IO)
    this.handleDisconnectRoomCleanup(socket).catch((err) =>
      console.error("Room cleanup error on disconnect:", err)
    );
  }

  private async handleDisconnectRoomCleanup(socket: SocketWithAuth): Promise<void> {
    // In-memory: iterate local map; Redis: we need to find rooms this socket was in.
    // We track socket->rooms in socketIdToRooms for the Redis path.
    const rooms = this.useRedis
      ? (await this.redisPublisher!.smembers(`socket:${socket.id}:rooms`))
      : Array.from(this.customRooms.keys()).filter((r) => this.customRooms.get(r)?.has(socket.id));

    for (const roomName of rooms) {
      await this.rRoomMemberDel(roomName, socket.id);
      if (this.useRedis) await this.redisPublisher!.srem(`socket:${socket.id}:rooms`, roomName);

      const count = await this.rRoomMemberCount(roomName);

      if (count === 0) {
        await this.rRoomDestroy(roomName);
      } else {
        // Transfer creator if necessary
        const creatorSocketId = await this.rCreatorGet(roomName);
        if (creatorSocketId === socket.id) {
          const members = await this.rRoomMembersAll(roomName);
          const remaining = members ? Array.from(members.keys()) : [];
          if (remaining.length > 0) {
            await this.rCreatorSet(roomName, remaining[0]);
            this.io?.to(`room:${roomName}`).emit("room:creator:changed", {
              room: roomName,
              newCreatorSocketId: remaining[0],
              newCreatorUserId: this.socketIdToUserId.get(remaining[0]),
              timestamp: new Date().toISOString(),
            });
          } else {
            await this.rCreatorDel(roomName);
          }
        }
      }

      this.io?.to(`room:${roomName}`).emit("room:user:left", {
        room: roomName,
        userId: socket.userId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    }

    // Clean up socket->rooms index in Redis
    if (this.useRedis) {
      await this.redisPublisher!.del(`socket:${socket.id}:rooms`);
    }
  }

  // ==========================================
  // Custom Room Management
  // ==========================================

  /**
   * Handle a user joining a custom room
   */
  async handleRoomJoin(socket: SocketWithAuth, roomName: string, metadata: Record<string, any> = {}): Promise<void> {
    // Validate room name
    if (!roomName || typeof roomName !== "string") {
      throw new APIError("Invalid room name", 400);
    }

    // Check if there's a validator for this room pattern
    for (const [pattern, validator] of this.roomValidators.entries()) {
      if (roomName.startsWith(pattern) || roomName === pattern) {
        const isValid = await validator(socket, roomName);
        if (!isValid) {
          throw new APIError("Not authorized to join this room", 403);
        }
        break;
      }
    }

    // Add socket to room member store (with metadata)
    await this.rRoomMemberSet(roomName, socket.id, metadata);

    // Track which rooms this socket is in (needed for fast Redis disconnect lookup)
    if (this.useRedis) {
      await this.redisPublisher!.sadd(`socket:${socket.id}:rooms`, roomName);
    }

    const creatorSocketId = await this.rCreatorGet(roomName);

    if (!creatorSocketId) {
      // First joiner — becomes both current and original creator
      await this.rCreatorSet(roomName, socket.id);
      await this.rOriginalCreatorSet(roomName, socket.userId!);
    } else {
      // Room already exists — check if the original creator is rejoining
      const originalCreatorId = await this.rOriginalCreatorGet(roomName);
      const currentCreatorUserId = this.socketIdToUserId.get(creatorSocketId);

      if (
        originalCreatorId !== null &&
        String(socket.userId) === String(originalCreatorId) &&
        String(socket.userId) !== String(currentCreatorUserId)
      ) {
        // Restore original creator's ownership
        await this.rCreatorSet(roomName, socket.id);
        this.io?.to(`room:${roomName}`).emit("room:creator:changed", {
          room: roomName,
          newCreatorSocketId: socket.id,
          newCreatorUserId: socket.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Join the Socket.IO room (prefixed with "room:")
    socket.join(`room:${roomName}`);

    console.log(`User ${socket.userId} joined custom room: ${roomName}`);

    // Notify others in the room
    socket.to(`room:${roomName}`).emit("room:user:joined", {
      room: roomName,
      userId: socket.userId,
      socketId: socket.id,
      metadata,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle a user leaving a custom room
   */
  async handleRoomLeave(socket: SocketWithAuth, roomName: string): Promise<void> {
    if (!roomName || typeof roomName !== "string") {
      throw new APIError("Invalid room name", 400);
    }

    const isMember = await this.rRoomMemberHas(roomName, socket.id);
    if (!isMember) return;

    await this.rRoomMemberDel(roomName, socket.id);
    if (this.useRedis) await this.redisPublisher!.srem(`socket:${socket.id}:rooms`, roomName);

    const count = await this.rRoomMemberCount(roomName);

    if (count === 0) {
      await this.rRoomDestroy(roomName);
    } else {
      // Transfer creator role if the leaving socket was the room owner
      const creatorSocketId = await this.rCreatorGet(roomName);
      if (creatorSocketId === socket.id) {
        const members = await this.rRoomMembersAll(roomName);
        const remaining = members ? Array.from(members.keys()) : [];
        if (remaining.length > 0) {
          await this.rCreatorSet(roomName, remaining[0]);
          this.io?.to(`room:${roomName}`).emit("room:creator:changed", {
            room: roomName,
            newCreatorSocketId: remaining[0],
            newCreatorUserId: this.socketIdToUserId.get(remaining[0]),
            timestamp: new Date().toISOString(),
          });
        } else {
          await this.rCreatorDel(roomName);
        }
      }
    }

    // Leave the Socket.IO room
    socket.leave(`room:${roomName}`);

    console.log(`User ${socket.userId} left custom room: ${roomName}`);

    // Notify others in the room
    this.io?.to(`room:${roomName}`).emit("room:user:left", {
      room: roomName,
      userId: socket.userId,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle a message sent to a custom room
   */
  async handleRoomMessage(socket: SocketWithAuth, roomName: string, event: string, payload: any, storeInHistory = true): Promise<void> {
    if (!roomName || typeof roomName !== "string") {
      throw new APIError("Invalid room name", 400);
    }

    // Check if the socket is in the room
    if (!(await this.rRoomMemberHas(roomName, socket.id))) {
      throw new APIError("Not a member of this room", 403);
    }

    const record = {
      event,
      payload,
      sender: { userId: socket.userId!, socketId: socket.id },
      timestamp: new Date().toISOString(),
    };

    // Broadcast to all room members (including sender)
    this.io?.to(`room:${roomName}`).emit(`room:${event}`, {
      room: roomName,
      ...record,
    });

    // Append to history only if requested
    if (storeInHistory) {
      await this.rHistoryPush(roomName, record);
    }
  }

  /**
   * Return member list for a room. Only callable by current room members.
   * Returns userId, socketId, metadata, and whether each member is the room creator.
   */
  async handleRoomMembers(
    socket: SocketWithAuth,
    roomName: string
  ): Promise<Array<{ socketId: string; userId: string | number; isCreator: boolean; metadata: Record<string, any> }>> {
    if (!roomName || typeof roomName !== "string") {
      throw new APIError("Invalid room name", 400);
    }

    const members = await this.rRoomMembersAll(roomName);
    if (!members) {
      throw new APIError("Room not found", 404);
    }

    // Only members of the room may query it
    if (!members.has(socket.id)) {
      throw new APIError("Not a member of this room", 403);
    }

    const creatorSocketId = await this.rCreatorGet(roomName);
    return Array.from(members.entries()).map(([socketId, metadata]) => ({
      socketId,
      userId: this.socketIdToUserId.get(socketId) ?? socketId,
      isCreator: socketId === creatorSocketId,
      metadata,
    }));
  }

  /**
   * Kick a user from a custom room. Only the room creator may do this.
   * All sockets belonging to the target user that are in the room will be removed.
   */
  async handleRoomKick(
    socket: SocketWithAuth,
    roomName: string,
    targetUserId: string | number
  ): Promise<void> {
    if (!roomName || typeof roomName !== "string") {
      throw new APIError("Invalid room name", 400);
    }

    const members = await this.rRoomMembersAll(roomName);
    if (!members) {
      throw new APIError("Room not found", 404);
    }

    // Only the room creator may kick
    const creatorSocketId = await this.rCreatorGet(roomName);
    if (creatorSocketId !== socket.id) {
      throw new APIError("Only the room creator can kick users", 403);
    }

    // A creator cannot kick themselves
    if (String(targetUserId) === String(socket.userId)) {
      throw new APIError("Room creator cannot kick themselves", 400);
    }

    const targetSockets = this.userSockets.get(targetUserId);
    if (!targetSockets || targetSockets.size === 0) {
      throw new APIError("Target user is not connected", 404);
    }

    let kicked = false;
    for (const targetSocket of targetSockets) {
      if (members.has(targetSocket.id)) {
        await this.rRoomMemberDel(roomName, targetSocket.id);
        if (this.useRedis) await this.redisPublisher!.srem(`socket:${targetSocket.id}:rooms`, roomName);
        targetSocket.leave(`room:${roomName}`);

        // Tell the kicked socket it was removed
        targetSocket.emit("room:kicked", {
          room: roomName,
          kickedBy: socket.userId,
          timestamp: new Date().toISOString(),
        });

        // Notify remaining room members
        this.io?.to(`room:${roomName}`).emit("room:user:left", {
          room: roomName,
          userId: targetUserId,
          socketId: targetSocket.id,
          timestamp: new Date().toISOString(),
        });

        kicked = true;
      }
    }

    if (!kicked) {
      throw new APIError("Target user is not in this room", 404);
    }

    // Clean up empty room
    const remaining = await this.rRoomMemberCount(roomName);
    if (remaining === 0) {
      await this.rRoomDestroy(roomName);
    }
  }

  /**
   * Handle custom events with registered handlers
   */
  async handleCustomEvent(
    socket: SocketWithAuth,
    event: string,
    payload: any,
    callback?: (response: any) => void
  ): Promise<void> {
    const handler = this.customMessageHandlers.get(event);
    if (!handler) {
      callback?.({ status: "error", message: `No handler registered for event: ${event}` });
      return;
    }

    await handler(socket, payload, callback);
  }

  // ==========================================
  // Public API for Custom Rooms (for extensions)
  // ==========================================

  /**
   * Register a custom message handler for a specific event
   * Can be used by extensions to handle custom socket events
   * 
   * @example
   * socketService.registerMessageHandler("game:move", async (socket, data, callback) => {
   *   // Handle game move logic
   *   callback?.({ status: "success", result: { ... } });
   * });
   */
  registerMessageHandler(event: string, handler: CustomMessageHandler): void {
    this.customMessageHandlers.set(event, handler);
    console.info(`Registered custom socket handler for event: ${event}`);
  }

  /**
   * Unregister a custom message handler
   */
  unregisterMessageHandler(event: string): void {
    this.customMessageHandlers.delete(event);
    console.info(`Unregistered custom socket handler for event: ${event}`);
  }

  /**
   * Register a validator for room join requests
   * Validator is called when a user tries to join a room matching the pattern
   * 
   * @example
   * socketService.registerRoomValidator("game:", async (socket, roomName) => {
   *   // Only allow admins to join game rooms
   *   return socket.userRole.name === "administrator";
   * });
   */
  registerRoomValidator(roomPattern: string, validator: RoomValidator): void {
    this.roomValidators.set(roomPattern, validator);
    console.info(`Registered room validator for pattern: ${roomPattern}`);
  }

  /**
   * Unregister a room validator
   */
  unregisterRoomValidator(roomPattern: string): void {
    this.roomValidators.delete(roomPattern);
    console.info(`Unregistered room validator for pattern: ${roomPattern}`);
  }

  /**
   * Broadcast a message to a custom room from server side
   * 
   * @example
   * socketService.broadcastToRoom("game:123", "game:state", { players: [...] });
   */
  broadcastToRoom(roomName: string, event: string, payload: any): void {
    if (!this.initialized || !this.io) {
      console.warn("Socket service not initialized");
      return;
    }

    this.io.to(`room:${roomName}`).emit(event, {
      room: roomName,
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast a message to all connected users
   * 
   * @example
   * socketService.broadcastToAll("system:announcement", { message: "Server maintenance in 5 minutes" });
   */
  broadcastToAll(event: string, payload: any): void {
    if (!this.initialized || !this.io) {
      console.warn("Socket service not initialized");
      return;
    }

    this.io.emit(event, {
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send a message to a specific user (all their connected sockets)
   * 
   * @example
   * socketService.sendToUser(userId, "private:message", { from: "admin", text: "Hello!" });
   */
  sendToUser(userId: string | number, event: string, payload: any): void {
    if (!this.initialized || !this.io) {
      console.warn("Socket service not initialized");
      return;
    }

    const userSocketSet = this.userSockets.get(userId);
    if (userSocketSet) {
      for (const socket of userSocketSet) {
        socket.emit(event, {
          payload,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Get list of users in a custom room (server-side utility for extensions)
   */
  async getRoomMembers(roomName: string): Promise<Array<{ socketId: string; userId: string | number; metadata: Record<string, any> }>> {
    const members = await this.rRoomMembersAll(roomName);
    if (!members) return [];
    return Array.from(members.entries()).map(([socketId, metadata]) => ({
      socketId,
      userId: this.socketIdToUserId.get(socketId) ?? socketId,
      metadata,
    }));
  }

  /**
   * Get count of users in a custom room
   */
  async getRoomMemberCount(roomName: string): Promise<number> {
    return this.rRoomMemberCount(roomName);
  }

  /**
   * Check if a room exists
   */
  async roomExists(roomName: string): Promise<boolean> {
    return (await this.rRoomMemberCount(roomName)) > 0;
  }

  /**
   * Get all custom rooms with member counts
   */
  async getCustomRooms(): Promise<Map<string, number>> {
    const rooms = new Map<string, number>();
    if (this.useRedis) {
      // Scan for all room member keys
      const keys = await this.redisPublisher!.keys("room:*:members");
      for (const key of keys) {
        const name = key.replace(/^room:/, "").replace(/:members$/, "");
        rooms.set(name, await this.redisPublisher!.hlen(key));
      }
    } else {
      for (const [name, members] of this.customRooms.entries()) {
        rooms.set(name, members.size);
      }
    }
    return rooms;
  }

  async checkCollectionAccess(socket: SocketWithAuth, collection: string): Promise<boolean> {
    return await permissionService.canAccess(socket.userRole.id, collection, "read");
  }

  /**
   * Whether this socket may join a workflow execution room. Allowed when the user
   * is an administrator, or triggered the execution, within the same tenant.
   */
  async canJoinExecutionRoom(socket: SocketWithAuth, executionId: string | number): Promise<boolean> {
    if (socket.userRole?.name === "administrator") return true;
    if (!socket.userId) return false;

    try {
      // Lazy import to avoid a circular dependency at module load.
      const { default: ItemsService } = await import("./ItemsService.js");
      const service = new ItemsService("baasix_WorkflowExecution", { accountability: undefined });
      const execution = await service.readOne(executionId, {
        fields: ["id", "triggered_by_Id", "tenant_Id"],
      });
      if (!execution) return false;

      // Must be the triggering user.
      if (execution.triggered_by_Id !== socket.userId) return false;

      // And, in multi-tenant mode, the same tenant.
      const userTenant = socket.userTenant?.id ?? null;
      if (execution.tenant_Id && userTenant && execution.tenant_Id !== userTenant) return false;

      return true;
    } catch {
      return false;
    }
  }

  getCollectionRoom(collection: string, tenantId?: string | number): string {
    return `collection:${collection}${tenantId ? `:tenant:${tenantId}` : ""}`;
  }

  broadcastChange(collection: string, action: string, data: any, accountability?: any): void {
    if (!this.initialized || !this.io) {
      console.warn("Socket service not initialized");
      return;
    }

    const excludeUserId = accountability?.user?.id;
    const tenantId = accountability?.tenant;

    // Strip hidden fields (password hashes, tokens, secrets) from the broadcast
    // payload so they never leak over the realtime channel (A12, field-level).
    const safeData = this.stripHiddenFromBroadcast(collection, data);

    // Prepare the event name and data
    const event = `${collection}:${action}`;
    const payload = {
      action,
      collection,
      data: safeData,
      timestamp: new Date().toISOString(),
    };

    // Broadcast to the collection room
    const roomName = this.getCollectionRoom(collection, tenantId);

    // A12 row-level scoping (opt-in). When REALTIME_ROW_LEVEL_SCOPING=true, evaluate
    // each subscriber's read permission against the changed row and emit only to
    // those allowed to see it. Default off = the fast O(1) room broadcast below.
    if (env.get("REALTIME_ROW_LEVEL_SCOPING") === "true") {
      // Async; fire-and-forget (broadcastChange is sync). Errors are contained so a
      // scoping failure never throws into the caller's write path.
      this.broadcastChangeScoped(collection, event, payload, roomName, tenantId).catch((err) => {
        console.error("Row-level realtime scoping failed:", err);
      });
      return;
    }

    if (tenantId) {
      // In multi-tenant mode, only broadcast to the specific tenant
      this.io.to(`${roomName}:tenant:${tenantId}`).emit(event, payload);
    } else {
      // Broadcast to all subscribers
      this.io.to(roomName).emit(event, payload);
    }
  }

  /**
   * A12 hybrid row-level scoping. For each subscriber in the room, decide whether
   * they may receive the changed row(s) based on their read permission:
   *  - admin, or a role with NO read conditions/relConditions → allowed (in-memory
   *    fast path, no DB).
   *  - otherwise → authoritative DB existence check via ItemsService.readByQuery
   *    with that subscriber's accountability (covers flat conditions, nested
   *    relConditions, tenant scoping, and field perms exactly like a normal read).
   * Subscribers are BUCKETED by role so each distinct role does at most one
   * existence query per changed id, not one per subscriber.
   */
  private async broadcastChangeScoped(
    collection: string,
    event: string,
    payload: any,
    roomName: string,
    tenantId: any
  ): Promise<void> {
    if (!this.io) return;

    // Collect the LOCAL sockets currently in this room (these carry our auth data).
    const targetRoom = tenantId ? `${roomName}:tenant:${tenantId}` : roomName;
    const sockets: SocketWithAuth[] = [];
    for (const s of this.io.sockets.sockets.values()) {
      const sock = s as unknown as SocketWithAuth;
      if (sock.rooms?.has(targetRoom)) sockets.push(sock);
    }
    if (sockets.length === 0) return;

    // Determine the changed row ids (single record or array).
    const records = Array.isArray(payload.data) ? payload.data : [payload.data];
    const { default: ItemsService } = await import("./ItemsService.js");
    const { schemaManager } = await import("../utils/schemaManager.js");
    const pk = schemaManager.getPrimaryKey(collection) || "id";
    const ids = records
      .map((r: any) => (r && typeof r === "object" ? r[pk] : undefined))
      .filter((v: any) => v !== undefined && v !== null);

    // Bucket sockets by role so identical roles share one decision.
    const buckets = new Map<string, { sockets: SocketWithAuth[]; sample: SocketWithAuth }>();
    for (const sock of sockets) {
      const roleKey = `${sock.userRole?.id ?? sock.userRole?.name ?? "none"}:${sock.userTenant?.id ?? ""}`;
      if (!buckets.has(roleKey)) buckets.set(roleKey, { sockets: [], sample: sock });
      buckets.get(roleKey)!.sockets.push(sock);
    }

    for (const { sockets: bucketSockets, sample } of buckets.values()) {
      const allowed = await this.canRoleSeeRecords(collection, sample, ids, pk, ItemsService);
      if (allowed) {
        for (const sock of bucketSockets) sock.emit(event, payload);
      }
    }
  }

  /**
   * Whether a subscriber's role may read the given record ids. Returns true if no
   * read restrictions apply (fast path), otherwise confirms via a permission-scoped
   * existence query. If there are multiple ids and they don't all pass, this returns
   * true (the bucket gets the event) — per-record splitting is a future refinement;
   * the common realtime case is a single changed record.
   */
  private async canRoleSeeRecords(
    collection: string,
    sample: SocketWithAuth,
    ids: any[],
    pk: string,
    ItemsService: any
  ): Promise<boolean> {
    // Admins see everything.
    if (sample.userRole?.name === "administrator") return true;
    if (ids.length === 0) return true; // nothing to scope (e.g. delete with no id)

    try {
      const roleId = sample.userRole?.id;
      const accountability = {
        user: { id: sample.userId },
        role: sample.userRole,
        tenant: sample.userTenant?.id,
      };

      // Fast path: role with NO read conditions and NO relConditions → allowed.
      const { canAccess, filter } = await permissionService.getFullPermissionData(
        roleId,
        collection,
        "read",
        accountability
      );
      if (!canAccess) return false;
      // Fast path: no row restrictions → allowed without a DB hit.
      if (!hasReadRestrictions(filter)) return true;

      // Authoritative check: can this accountability actually read these ids?
      const service = new ItemsService(collection, { accountability });
      const result = await service.readByQuery({
        filter: { [pk]: { in: ids } },
        fields: [pk],
        limit: ids.length,
      });
      const rows = (result?.data ?? result) as any[];
      const visibleIds = (Array.isArray(rows) ? rows : []).map((r) => r[pk]);
      // Allow the bucket if EVERY changed id is visible to this role.
      return allIdsVisible(ids, visibleIds);
    } catch (err) {
      // Fail CLOSED on error — do not leak a row we couldn't verify.
      console.error(`Row-level scoping check failed for ${collection}:`, err);
      return false;
    }
  }

  /**
   * Remove hidden schema fields (password, tokens, secrets) from a broadcast
   * payload. Handles a single record or an array of records; non-objects pass
   * through unchanged.
   */
  private stripHiddenFromBroadcast(collection: string, data: any): any {
    try {
      if (Array.isArray(data)) {
        return fieldUtils.stripHiddenFieldsFromRecords(collection, data);
      }
      if (data && typeof data === "object") {
        return fieldUtils.stripHiddenFields(collection, data);
      }
    } catch {
      // On any error, fail safe by dropping the data rather than leaking it raw.
      return undefined;
    }
    return data;
  }

  /**
   * Emit workflow execution updates to connected clients
   */
  emitWorkflowExecutionUpdate(executionId: string | number, data: any): void {
    if (!this.initialized || !this.io) {
      console.log("⚠️ Socket not initialized, cannot emit workflow execution update");
      return;
    }

    const payload = {
      executionId,
      ...data,
      timestamp: new Date().toISOString(),
    };

    console.log(`📡 Emitting workflow:execution:update to room execution:${executionId}`, payload);
    this.io.to(`execution:${executionId}`).emit("workflow:execution:update", payload);
  }

  /**
   * Emit workflow execution completion
   */
  emitWorkflowExecutionComplete(executionId: string | number, data: any): void {
    if (!this.initialized || !this.io) {
      return;
    }

    this.io.to(`execution:${executionId}`).emit("workflow:execution:complete", {
      executionId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  getStats(): any {
    if (!this.initialized || !this.io) {
      return {
        status: "not initialized",
        totalConnections: 0,
        uniqueUsers: 0,
        customRooms: 0,
        registeredHandlers: 0,
      };
    }

    // Build custom rooms summary (in-memory only; Redis path is async so omitted here)
    const customRoomsSummary: Record<string, number> = {};
    for (const [name, members] of this.customRooms.entries()) {
      customRoomsSummary[name] = members.size;
    }

    return {
      status: this.useRedis ? "redis" : "in-memory",
      totalConnections: this.io.engine.clientsCount,
      uniqueUsers: this.userSockets.size,
      rooms: this.io.sockets.adapter.rooms,
      customRooms: {
        count: this.useRedis ? "(see Redis)" : this.customRooms.size,
        rooms: this.useRedis ? "(see Redis)" : customRoomsSummary,
      },
      registeredHandlers: Array.from(this.customMessageHandlers.keys()),
      registeredValidators: Array.from(this.roomValidators.keys()),
    };
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_socketService: SocketService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_socketService) {
  globalThis.__baasix_socketService = new SocketService();
}

const socketService = globalThis.__baasix_socketService;
export default socketService;
