import env from "../utils/env.js";
import { promises as fs, createWriteStream } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { getProjectPath } from "../utils/dirname.js";
import { assertSafeFetchUrl } from "../utils/ssrfGuard.js";
import sharp from "sharp";
// @ts-ignore - No type definitions available
import ffprobe from "ffprobe";
// @ts-ignore - No type definitions available
import { path as ffprobePath } from "ffprobe-static";
import { lookup } from "mime-types";
import ItemsService from "./ItemsService.js";
import storageService, { resolveStorageKey } from "./StorageService.js";
import { APIError } from "../utils/errorHandler.js";
import axios from "axios";
import { db } from "../utils/db.js";
import { eq } from "drizzle-orm";
import type { FileData, FileMetadata, InternalUploadedFile } from '../types/index.js';

// Import baasix_File table schema
// This will need to be imported from your schema file
// For now, we'll assume it's available

/** True if the foldered physical storage layout is enabled (default off). */
export function storageFolderStructureEnabled(): boolean {
  return env.get("STORAGE_FOLDER_STRUCTURE") === "true";
}

/**
 * Sanitize a single path segment (tenant/user id) for safe use in a storage key:
 * keep only [A-Za-z0-9_-] so no slashes/dots/null bytes can enable traversal.
 * Returns "_" for an empty/invalid value so a key is always well-formed.
 */
function safeSegment(value: any): string {
  const s = String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return s.length > 0 ? s : "_";
}

/**
 * Build the storage FOLDER prefix for a file from its owner context. Returns null
 * when the foldered layout is off (file stays flat). Layout:
 *   tenants/{tenantId}/users/{userId}   — tenant + user file
 *   tenants/{tenantId}/system           — tenant + no user (system-generated)
 *   users/{userId}                       — no tenant + user file
 *   system                               — no tenant + no user (system-generated)
 * This value is stored in baasix_File.storage_folder; the full physical key is
 * `storage_folder + "/" + filename`.
 */
export function buildStorageFolder(
  ctx: { tenant_Id?: any; userCreated_Id?: any }
): string | null {
  if (!storageFolderStructureEnabled()) return null;

  const hasTenant = ctx.tenant_Id !== undefined && ctx.tenant_Id !== null && ctx.tenant_Id !== "";
  const hasUser = ctx.userCreated_Id !== undefined && ctx.userCreated_Id !== null && ctx.userCreated_Id !== "";

  const parts: string[] = [];
  if (hasTenant) parts.push("tenants", safeSegment(ctx.tenant_Id));
  if (hasUser) parts.push("users", safeSegment(ctx.userCreated_Id));
  else parts.push("system");
  return parts.join("/");
}

/**
 * The SINGLE source of truth for a file's full physical storage key. Every read /
 * serve / delete / processed-cache path must resolve the key through this, so the
 * storage_folder + filename split is invisible to the rest of the system.
 *   - storage_folder set  → `${storage_folder}/${filename}`  (new foldered layout)
 *   - storage_folder null → `filename`                       (legacy flat layout)
 * Accepts either a file record or a {storage_folder, filename} pair.
 */
export function getStorageKey(file: { storage_folder?: string | null; filename: string }): string {
  const folder = file.storage_folder;
  if (folder && typeof folder === "string" && folder.length > 0) {
    return `${folder}/${file.filename}`;
  }
  return file.filename;
}

class FilesService {
  protected accountability?: any;
  protected storageService: typeof storageService;
  private itemService: ItemsService;
  private tempDir: string;

  constructor(params: { accountability?: any } = {}) {
    const { accountability } = params;
    this.accountability = accountability;
    this.storageService = storageService;
    this.itemService = new ItemsService("baasix_File", { accountability });
    this.tempDir = env.get("STORAGE_TEMP_PATH") || os.tmpdir();
  }

  /**
   * Coerce metadata values to correct types
   * Form data sends booleans as strings, need to convert them
   */
  private coerceMetadataTypes(metadata: FileMetadata): FileMetadata {
    const coerced = { ...metadata };
    
    // Handle isPublic boolean field
    if ('isPublic' in coerced) {
      if (typeof coerced.isPublic === 'string') {
        (coerced as any).isPublic = (coerced.isPublic as string).toLowerCase() === 'true';
      }
    }
    
    return coerced;
  }

  async createOne(fileData: FileData, metadata: FileMetadata = {}): Promise<string | number> {
    const { file } = fileData;
    if (!file) throw new APIError("File is required", 400);

    // Coerce metadata types (form data sends booleans as strings)
    const coercedMetadata = this.coerceMetadataTypes(metadata);

    const storage = coercedMetadata.storage || env.get("STORAGE_DEFAULT_SERVICE");
    let uniqueid: string | number | null = null;

    try {
      // Upload to temp location
      const tempPath = file.path || (await this.uploadToTemp(file));

      // Create a temporary entry with required fields
      const { title, name, description, originalFilename, ...remainingMetadata } = coercedMetadata;

      // Use originalFilename from metadata if provided, otherwise use uploaded file name
      const resolvedOriginalFilename = originalFilename || file.name;

      const initFileDetails: any = {
        title: title || file.name,
        filename: name || file.name,
        originalFilename: resolvedOriginalFilename,
        description: description || null,
        storage: storage,
        size: file.size,
        type: file.mimetype || file.type || (await this.getFileType(tempPath)) || "application/octet-stream",
        ...remainingMetadata
      };

      uniqueid = await this.itemService.createOne(initFileDetails);

      // Owner context for the storage folder. We take tenant_Id from the persisted
      // record (ItemsService sets it from tenant scoping) and the USER from the
      // current accountability directly — this gives per-user folders independent of
      // whether baasix_File has the `usertrack` flag, and without changing
      // userCreated_Id population for anyone. bypassPermissions: internal read.
      let ownerContext: { tenant_Id?: any; userCreated_Id?: any } = {};
      if (storageFolderStructureEnabled()) {
        const created = await this.itemService.readOne(
          uniqueid,
          { fields: ["tenant_Id", "userCreated_Id"] },
          true
        );
        ownerContext = {
          tenant_Id: created?.tenant_Id,
          // Prefer the recorded creator (when usertrack is on), else the current user.
          userCreated_Id: created?.userCreated_Id ?? this.accountability?.user?.id ?? null,
        };
      }

      const uploadedFile = await this.handleFileUpload(tempPath, file.name, storage!, uniqueid, ownerContext);

      const fileDetails = await this.getFileDetails(uploadedFile, tempPath, {
        ...coercedMetadata,
        storage,
        filename: uploadedFile.filename,
        originalFilename: resolvedOriginalFilename,
      });

      // Update the entry with full file details
      // Using Drizzle instead of Sequelize
      // Bypass permissions since user already passed create permission check
      // and this is an internal update to the record they just created
      await this.itemService.updateOne(uniqueid, fileDetails, { bypassPermissions: true });

      // Clean up temp file
      await fs.unlink(tempPath);

      return uniqueid;
    } catch (error) {
      // If an error occurs, attempt to delete the temporary entry
      // Bypass permissions since this is cleanup for a failed create operation
      if (uniqueid) {
        await this.itemService.deleteOne(uniqueid, { bypassPermissions: true }).catch(console.error);
      }
      throw error;
    }
  }

  async uploadToTemp(file: any): Promise<string> {
    console.log("Uploading to temp", file.name);
    const originalExtension = path.extname(file.name);
    const tempFilename = crypto.randomBytes(16).toString("hex") + originalExtension;
    // Create temp directory if it doesn't exist
    await fs.mkdir(this.tempDir, { recursive: true });
    const tempPath = path.join(this.tempDir, tempFilename);

    if (file.path) {
      // File is on disk, move it to temp
      await fs.copyFile(file.path, tempPath);
    } else if (file.data) {
      // File is in memory, write it to temp
      await fs.writeFile(tempPath, file.data);
    } else {
      throw new APIError("Invalid file object", 400);
    }

    return tempPath;
  }

  async handleFileUpload(
    tempPath: string,
    originalFilename: string,
    storage: string,
    uniqueid: string | number,
    ownerContext?: { tenant_Id?: any; userCreated_Id?: any }
  ): Promise<InternalUploadedFile> {
    const provider = this.storageService.getProvider(storage);

    const extension = path.extname(originalFilename);
    // `filename` is the LEAF only; the owner folder prefix is stored separately as
    // storage_folder. The full physical key = storage_folder + "/" + filename.
    const filename = `${uniqueid}-${path.basename(originalFilename, extension).substring(0, 40)}${extension}`;
    const storage_folder = buildStorageFolder(ownerContext || {}); // null when feature off
    const fullKey = getStorageKey({ storage_folder, filename });
    let filePath: string;

    const fileContent = await fs.readFile(tempPath);

    if (provider.driver === "LOCAL") {
      filePath = resolveStorageKey(provider.basePath!, fullKey);
      const destinationDir = path.dirname(filePath);
      await fs.mkdir(destinationDir, { recursive: true });
      await fs.writeFile(filePath, fileContent);
    } else if (provider.driver === "S3") {
      filePath = fullKey; // For S3, the path is just the key
      await provider.saveFile(filePath, fileContent);
    } else {
      throw new APIError(`Unsupported storage driver: ${provider.driver}`, 400);
    }

    return {
      path: filePath,
      filename: filename,
      storage_folder: storage_folder,
      name: originalFilename,
    };
  }

  async getFileDetails(
    file: InternalUploadedFile,
    tempPath: string,
    { storage, folder, filename, title, description, type, originalFilename }: FileMetadata
  ): Promise<any> {
    if (!type) type = await this.getFileType(tempPath);

    const fileDetails: any = {
      filename: filename || file.name,
      // Persist the physical folder prefix (null = legacy flat layout) alongside the
      // leaf filename, so the full key is reconstructed via getStorageKey().
      storage_folder: file.storage_folder ?? null,
      title: title || file.name,
      description: description || "",
      storage: storage,
      type: type,
      size: (await fs.stat(tempPath)).size,
      originalFilename: originalFilename || file.name,
    };

    if (fileDetails.type.startsWith("image/")) {
      const metadata = await sharp(tempPath).metadata();
      fileDetails.width = metadata.width;
      fileDetails.height = metadata.height;
      fileDetails.metadata = metadata;
      delete fileDetails.metadata.icc;
    } else if (fileDetails.type.startsWith("video/") || fileDetails.type.startsWith("audio/")) {
      const metadata = await ffprobe(tempPath, { path: ffprobePath });
      fileDetails.duration = Math.round(metadata.streams[0].duration);
      fileDetails.metadata = metadata;
    }
    return fileDetails;
  }

  async getFileType(filePath: string): Promise<string> {
    console.log("Getting file type for", filePath);
    const mimeType = lookup(filePath);
    if (!mimeType) return "application/octet-stream";
    return mimeType;
  }

  async readByQuery(query: any): Promise<any> {
    return this.itemService.readByQuery(query);
  }

  async readOne(id: string | number, query?: any, bypassPermissions = false): Promise<any> {
    return this.itemService.readOne(id, query, bypassPermissions);
  }

  async updateOne(id: string | number, fileData: FileData, metadata: FileMetadata = {}): Promise<string | number> {
    const existingFile = await this.itemService.readOne(id);
    if (!existingFile) throw new APIError("File not found", 404);

    // Coerce metadata types (form data sends booleans as strings)
    const coercedMetadata = this.coerceMetadataTypes(metadata);

    const { file } = fileData;
    let fileDetails: any = {
      ...coercedMetadata,
    };

    if (file) {
      const storage = coercedMetadata.storage || existingFile.storage;
      const uploadedFile = await this.handleFileUpload(file.path, file.name, storage, id);
      fileDetails = {
        ...fileDetails,
        ...(await this.getFileDetails(uploadedFile, file.path, {
          ...coercedMetadata,
          storage,
          filename: uploadedFile.filename,
        })),
      };
    }

    await this.itemService.updateOne(id, fileDetails);

    if (file) {
      await this.deleteFile(existingFile);
    }

    return id;
  }

  async deleteOne(id: string | number): Promise<string | number> {
    const file = await this.itemService.readOne(id);
    if (!file) throw new APIError("File not found", 404);

    await this.itemService.deleteOne(id);
    await this.deleteFile(file);

    return id;
  }

  async deleteFile(file: any): Promise<void> {
    if (!file) throw new APIError("File not found", 404);

    const provider = this.storageService.getProvider(file.storage);
    const key = getStorageKey(file);

    if (provider.driver === "LOCAL") {
      const filePath = resolveStorageKey(provider.basePath!, key);
      if (
        await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false)
      ) {
        await fs.unlink(filePath);
      }
    } else if (provider.driver === "S3") {
      await provider.deleteFile(key);
    } else {
      throw new APIError(`Unsupported storage driver: ${provider.driver}`, 400);
    }

    // Clean up any processed/resized versions of this image
    try {
      await this.deleteProcessedVersions(file);
    } catch (error) {
      console.error("Failed to delete processed versions:", error);
    }
  }

  /**
   * Delete processed/resized versions of an image file.
   * Override in AssetsService for the actual implementation.
   */
  protected async deleteProcessedVersions(_file: any): Promise<void> {
    // No-op in base FilesService; AssetsService overrides this
  }

  async uploadFromUrl(fileUrl: string, metadata: FileMetadata = {}): Promise<string | number> {
    const fileName = fileUrl.split("/").pop() || "download";
    const tempPath = getProjectPath(env.get("STORAGE_TEMP_PATH") || "temp", `temp-${fileName}`);

    try {
      await fs.mkdir(path.dirname(tempPath), { recursive: true });
      await this.downloadFile(fileUrl, tempPath);

      const fileStats = await fs.stat(tempPath);
      const file = {
        path: tempPath,
        name: fileName,
        size: fileStats.size,
      };

      return this.createOne({ file }, metadata);
    } catch (error) {
      console.error(error);
      throw new APIError("Error downloading or uploading the file", 500);
    }
  }

  async downloadFile(url: string, outputLocationPath: string): Promise<void> {
    // SSRF guard: validate the URL (and every redirect hop) against private/
    // loopback/link-local/metadata ranges before fetching. We disable axios's
    // automatic redirects and follow them manually so each hop is re-validated —
    // otherwise an allowlisted host could 302 to 169.254.169.254.
    const maxHops = 5;
    const maxBytes = parseInt(env.get("MAX_UPLOAD_FILE_SIZE") || "50") * 1024 * 1024;
    // Response timeout per request/redirect hop (time-to-first-response, not total
    // download time — with responseType:"stream" axios's timeout governs receiving
    // the response, not the body transfer). Total bytes are bounded by maxBytes.
    const timeoutMs = parseInt(env.get("URL_FETCH_TIMEOUT_MS") || "15000");

    let currentUrl = url;
    let response: any;
    for (let hop = 0; ; hop++) {
      await assertSafeFetchUrl(currentUrl);

      response = await axios({
        url: currentUrl,
        method: "GET",
        responseType: "stream",
        maxRedirects: 0,            // we follow redirects ourselves to re-validate
        timeout: timeoutMs,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        // Treat 3xx as a non-error so we can inspect Location.
        validateStatus: (s: number) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.location;
        // Drain the redirect response body to free the socket.
        response.data?.destroy?.();
        if (!location) throw new APIError("Redirect without Location header", 400);
        if (hop >= maxHops) throw new APIError("Too many redirects", 400);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break; // 2xx — proceed to stream
    }

    const writer = createWriteStream(outputLocationPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  /** Read a provider object fully into a Buffer (handles both Buffer and stream). */
  private async readProviderObject(provider: any, key: string): Promise<Buffer> {
    const data = await provider.getFile(key);
    if (Buffer.isBuffer(data)) return data;
    const chunks: Uint8Array[] = [];
    for await (const chunk of data) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  /**
   * Migrate existing files into the foldered storage layout (tenant/user/system).
   *
   * Per file, the move is crash-safe: copy → verify → update DB pointer → delete old.
   * The file stays readable at every step (the DB only points at the new key once the
   * copy is verified). Idempotent: files already in the new layout are skipped, so the
   * migration is safely resumable / re-runnable. Per-file errors are recorded and
   * skipped, never fatal.
   *
   * @param options.dryRun  When true, only report the planned moves; touch nothing.
   * @param options.limit   Max files to process this call (for batching large sets).
   * @returns A summary { scanned, moved, skipped, failed, planned[] }.
   */
  async migrateStorageStructure(
    options: { dryRun?: boolean; limit?: number } = {}
  ): Promise<{
    dryRun: boolean;
    scanned: number;
    moved: number;
    skipped: number;
    failed: number;
    planned: Array<{ id: any; from: string; to: string; status: string; error?: string }>;
  }> {
    const dryRun = options.dryRun === true;
    const limit = options.limit && options.limit > 0 ? options.limit : 1000;

    if (!storageFolderStructureEnabled()) {
      throw new APIError(
        "STORAGE_FOLDER_STRUCTURE is not enabled. Set it to true before migrating.",
        400
      );
    }

    // RESUME MARKER: only files with NO storage_folder are un-migrated (still in the
    // legacy flat layout where `filename` is the whole key). Already-migrated files
    // have storage_folder set and are skipped — so this is idempotent and safely
    // resumable even if a previous run stopped midway. System-context read (bypass).
    const result = await this.itemService.readByQuery(
      {
        filter: { storage_folder: { isNull: true } },
        fields: ["id", "filename", "storage", "tenant_Id", "userCreated_Id", "type"],
        limit,
      },
      true
    );
    const files: any[] = (result as any)?.data ?? result ?? [];

    const summary = {
      dryRun,
      scanned: files.length,
      moved: 0,
      skipped: 0,
      failed: 0,
      planned: [] as Array<{ id: any; from: string; to: string; status: string; error?: string }>,
    };

    for (const file of files) {
      const leaf: string = file.filename;
      if (!leaf || typeof leaf !== "string") {
        summary.skipped++;
        continue;
      }

      // Un-migrated file: old key is the flat filename; new folder from owner context.
      const newFolder = buildStorageFolder({
        tenant_Id: file.tenant_Id,
        userCreated_Id: file.userCreated_Id,
      });
      // If the layout yields no folder (shouldn't happen when enabled), skip safely.
      if (!newFolder) {
        summary.skipped++;
        continue;
      }
      const oldKey = leaf; // flat
      const newKey = `${newFolder}/${leaf}`;

      const plan = { id: file.id, from: oldKey, to: newKey, status: "planned" as string, error: undefined as string | undefined };

      if (dryRun) {
        summary.planned.push(plan);
        continue;
      }

      try {
        const provider = this.storageService.getProvider(file.storage);

        // 1. Copy the object to the new key.
        const content = await this.readProviderObject(provider, oldKey);
        await provider.saveFile(newKey, content);

        // 2. Verify the copy before committing the DB pointer.
        const verify = await this.readProviderObject(provider, newKey);
        if (!verify || verify.length !== content.length) {
          throw new Error("Verification failed: copied object size mismatch");
        }

        // 3. Set storage_folder (filename/leaf is unchanged). After this the record
        //    resolves to the NEW key via getStorageKey(); the old object is now stale.
        await this.itemService.updateOne(file.id, { storage_folder: newFolder }, { bypassPermissions: true });

        // 4. Move processed/cache variants next to the original (best-effort; cache
        //    is regenerable, so variant failures don't fail the file).
        try {
          if (provider.listFiles) {
            const base = leaf.includes(".") ? leaf.substring(0, leaf.lastIndexOf(".")) : leaf;
            const variants = await provider.listFiles(`${base}_processed_`);
            for (const v of variants) {
              if (v.includes("/")) continue; // only flat variants belong to a flat original
              const vNew = `${newFolder}/${v}`;
              const vContent = await this.readProviderObject(provider, v);
              await provider.saveFile(vNew, vContent);
              await provider.deleteFile(v);
            }
          }
        } catch (variantErr: any) {
          console.warn(`Migration: variant move skipped for ${oldKey}:`, variantErr?.message);
        }

        // 5. Delete the old original now that the DB resolves to the verified new key.
        await provider.deleteFile(oldKey);

        plan.status = "moved";
        summary.moved++;
        summary.planned.push(plan);
      } catch (err: any) {
        plan.status = "failed";
        plan.error = err?.message || String(err);
        summary.failed++;
        summary.planned.push(plan);
        console.error(`Migration failed for file ${file.id} (${oldKey}):`, err?.message);
      }
    }

    return summary;
  }
}

export default FilesService;
