import env from "../utils/env.js";
import fs from "fs/promises";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { existsSync, mkdirSync } from "fs";
import type { StorageProvider } from '../types/index.js';
import { getProjectPath } from "../utils/dirname.js";

/**
 * Resolve a storage key/filename to an absolute path confined within `basePath`.
 * Defense-in-depth against path traversal: rejects null bytes and any key that
 * resolves outside the storage root (e.g. "../../etc/passwd"). Use this for EVERY
 * local-disk operation that joins a (potentially client-influenced) filename.
 * @throws Error if the key is invalid or escapes basePath.
 */
export function resolveStorageKey(basePath: string, key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Invalid storage path");
  }
  // Null bytes are always rejected — never a valid filename, no reason to allow.
  if (key.includes("\0")) {
    throw new Error("Invalid storage path: null byte");
  }
  const resolvedBase = path.resolve(basePath);
  const fullPath = path.resolve(resolvedBase, key);
  // Path-traversal confinement. Configurable: STORAGE_PATH_CONFINEMENT=false
  // relaxes the "must stay within storage root" check (NOT recommended).
  const confine = env.get("STORAGE_PATH_CONFINEMENT") !== "false";
  if (confine && fullPath !== resolvedBase && !fullPath.startsWith(resolvedBase + path.sep)) {
    throw new Error("Invalid storage path: escapes storage root");
  }
  return fullPath;
}

class StorageService {
  private providers: Record<string, StorageProvider> = {};

  constructor() {
    console.info("Initializing Storage Service");
  }

  initialize(): void {
    const servicesEnabled = env.get("STORAGE_SERVICES_ENABLED")?.split(",") || [];

    if (servicesEnabled.length === 0) {
      console.warn("No storage services enabled. Check your STORAGE_SERVICES_ENABLED environment variable.");
      return;
    }

    servicesEnabled.forEach((service) => this.initializeProvider(service.trim()));

    console.info("Storage Service Initialization Complete");
  }

  initializeProvider(service: string): void {
    const upperService = service.toUpperCase();
    const driver = env.get(`${upperService}_STORAGE_DRIVER`);

    if (!driver) {
      console.warn(`Storage driver not specified for ${service}. Skipping.`);
      return;
    }

    switch (driver) {
      case "LOCAL":
        this.initializeLocalStorage(service, upperService);
        break;
      case "S3":
        this.initializeS3Storage(service, upperService);
        break;
      default:
        console.warn(`Unknown storage driver '${driver}' for ${service}. Skipping.`);
    }
  }

  initializeLocalStorage(service: string, upperService: string): void {
    const storagePath = env.get(`${upperService}_STORAGE_PATH`);
    if (!storagePath) {
      throw new Error(`${upperService}_STORAGE_PATH is not defined`);
    }

    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
    }

    const basePath = path.resolve(getProjectPath(storagePath));

    this.providers[service] = {
      driver: "LOCAL",
      basePath,
      async saveFile(filePath: string, fileContent: Buffer | Uint8Array) {
        const fullPath = resolveStorageKey(basePath, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, fileContent);
        return filePath;
      },
      async getFile(filePath: string) {
        const fullPath = resolveStorageKey(basePath, filePath);
        return fs.readFile(fullPath);
      },
      async deleteFile(filePath: string) {
        const fullPath = resolveStorageKey(basePath, filePath);
        await fs.unlink(fullPath);
      },
      async listFiles(prefix: string) {
        const files = await fs.readdir(basePath);
        return files.filter((f) => f.startsWith(prefix));
      },
      getPublicUrl(filePath: string) {
        return `/storage/${service}/${filePath}`;
      },
    };

    console.info(`Loaded LOCAL Storage Config for: ${service}`);
  }

  initializeS3Storage(service: string, upperService: string): void {
    const requiredEnvVars = [
      `${upperService}_STORAGE_ACCESS_KEY_ID`,
      `${upperService}_STORAGE_SECRET_ACCESS_KEY`,
      `${upperService}_STORAGE_REGION`,
      `${upperService}_STORAGE_BUCKET`,
      `${upperService}_STORAGE_ENDPOINT`,
    ];

    requiredEnvVars.forEach((envVar) => {
      if (!env.get(envVar)) {
        throw new Error(`${envVar} is not defined`);
      }
    });

    const s3Client = new S3Client({
      region: env.get(`${upperService}_STORAGE_REGION`)!,
      credentials: {
        accessKeyId: env.get(`${upperService}_STORAGE_ACCESS_KEY_ID`)!,
        secretAccessKey: env.get(`${upperService}_STORAGE_SECRET_ACCESS_KEY`)!,
      },
      endpoint: "https://" + env.get(`${upperService}_STORAGE_ENDPOINT`),
    });

    const bucketName = env.get(`${upperService}_STORAGE_BUCKET`)!;

    this.providers[service] = {
      driver: "S3",
      s3Client,
      bucketName,
      async saveFile(filePath: string, fileContent: Buffer | Uint8Array) {
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: filePath,
          Body: fileContent,
        });
        await s3Client.send(command);
        return filePath;
      },
      async getFile(filePath: string) {
        const command = new GetObjectCommand({
          Bucket: bucketName,
          Key: filePath,
        });
        const response = await s3Client.send(command);
        return response.Body;
      },
      async deleteFile(filePath: string) {
        const command = new DeleteObjectCommand({
          Bucket: bucketName,
          Key: filePath,
        });
        await s3Client.send(command);
      },
      async listFiles(prefix: string) {
        const command = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
        });
        const response = await s3Client.send(command);
        return (response.Contents || []).map((obj: any) => obj.Key!).filter(Boolean);
      },
      async getPublicUrl(filePath: string) {
        const command = new GetObjectCommand({
          Bucket: bucketName,
          Key: filePath,
        });

        const expiration = 3600; // 1 hour

        return getSignedUrl(s3Client, command, { expiresIn: expiration });
      },
    };

    console.info(`Loaded S3 Storage Config for: ${service}`);
  }

  getProvider(service: string): StorageProvider {
    const provider = this.providers[service];
    if (!provider) {
      throw new Error(`Storage provider '${service}' not found`);
    }
    return provider;
  }

  async saveFile(service: string, filePath: string, fileContent: Buffer | Uint8Array): Promise<string> {
    const provider = this.getProvider(service);
    return provider.saveFile(filePath, fileContent);
  }

  async getFile(service: string, filePath: string): Promise<any> {
    const provider = this.getProvider(service);
    return provider.getFile(filePath);
  }

  async deleteFile(service: string, filePath: string): Promise<void> {
    const provider = this.getProvider(service);
    return provider.deleteFile(filePath);
  }

  async getPublicUrl(service: string, filePath: string): Promise<string> {
    const provider = this.getProvider(service);
    const result = provider.getPublicUrl(filePath);
    return result instanceof Promise ? await result : result;
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_storageService: StorageService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_storageService) {
  globalThis.__baasix_storageService = new StorageService();
}

const storageService = globalThis.__baasix_storageService;
export default storageService;
