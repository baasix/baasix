import env from "../utils/env.js";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import FilesService from "./FilesService.js";
import ItemsService from "./ItemsService.js";
import type { AssetQuery, AssetResult, ProcessedImage } from '../types/index.js';
import { getProjectPath } from "../utils/dirname.js";
import { resolveStorageKey } from "./StorageService.js";

/**
 * Returns the set of shared asset tenant IDs and the access mode.
 * Read at call time (not module load) so env overrides take effect.
 */
function getSharedAssetConfig() {
  const mode = env.get("SHARED_ASSET_ACCESS_MODE") as "public" | "authenticated" | undefined;
  const idsString = env.get("SHARED_ASSET_TENANT_IDS");
  const ids = new Set(
    idsString
      ? idsString.split(",").map((id: string) => id.trim()).filter(Boolean)
      : []
  );
  return { mode, ids };
}

class AssetsService extends FilesService {
  private assetTempDir: string;
  private itemsService: ItemsService;
  // ItemsService without accountability - bypasses tenant filtering for file lookups
  private systemItemsService: ItemsService;

  constructor(params: { accountability?: any } = {}) {
    const { accountability } = params;
    super({ accountability });
    
    // Temp directory for S3 file processing (not for caching)
    this.assetTempDir = env.get("ASSET_TEMP_DIR") || getProjectPath("asset-temp");
    if (!fs.existsSync(this.assetTempDir)) {
      fs.mkdirSync(this.assetTempDir, { recursive: true });
    }
    
    this.itemsService = new ItemsService("baasix_File", { accountability });
    this.systemItemsService = new ItemsService("baasix_File", {});
  }

  async getAsset(id: string | number, query: AssetQuery, bypassPermissions = false): Promise<AssetResult> {
    let file: any;
    
    if (bypassPermissions) {
      // If bypassPermissions is explicitly requested, use it directly
      file = await this.systemItemsService.readOne(id, {}, true);
    } else {
      // For public files, shared tenant files, and regular files we need different handling.
      // Use systemItemsService (no accountability = no tenant filter) to check the file first,
      // then decide based on isPublic / shared tenant config whether to grant access.
      const fileCheck = await this.systemItemsService.readOne(id, {}, true);
      
      if (!fileCheck) {
        throw new Error("File not found");
      }
      
      // If file is public, allow access without permission check
      if (fileCheck.isPublic === true) {
        file = fileCheck;
      } else {
        // Check shared asset tenant configuration
        const { mode: sharedMode, ids: sharedTenantIds } = getSharedAssetConfig();
        if (fileCheck.tenant_Id && sharedTenantIds.size > 0 && sharedTenantIds.has(String(fileCheck.tenant_Id))) {
          // File belongs to a shared asset tenant
          if (sharedMode === "public") {
            // Public mode: anyone can access shared tenant assets
            file = fileCheck;
          } else if (sharedMode === "authenticated" && this.accountability?.user) {
            // Authenticated mode: only authenticated users can access
            file = fileCheck;
          } else {
            // Mode not matched or user not authenticated, check permissions normally
            file = await this.itemsService.readOne(id, {}, false);
          }
        } else {
          // File is not public and not from shared tenant, check permissions normally
          file = await this.itemsService.readOne(id, {}, false);
        }
      }
    }

    if (!file) throw new Error("File not found");

    const provider = this.storageService.getProvider(file.storage);
    const isS3 = provider.driver === "S3";
    
    // For S3 video/audio files, we don't need to download the file
    if (isS3 && (file.type.startsWith("video/") || file.type.startsWith("audio/"))) {
      return {
        buffer: null,
        contentType: file.type,
        filePath: null,
        file: file,
        isS3: true
      };
    }

    const { width, height, fit, quality, withoutEnlargement, format } = query;
    const hasTransformParams = width || height || quality || format;

    // Get content type with fallback
    const fileContentType = file.type || await this.getFileType(file.filename) || "application/octet-stream";

    if (fileContentType.startsWith("image/")) {
      // If no transform params, return the original image
      if (!hasTransformParams) {
        const buffer = await this.getFileBuffer(file, provider, isS3);
        return {
          buffer,
          contentType: fileContentType,
          filePath: null,
          file: file,
          isS3: isS3
        };
      }

      // Generate processed filename to store alongside original
      const processedFilename = this.getProcessedFilename(file.filename, query);
      
      // Check if processed version exists in storage
      const processedBuffer = await this.getProcessedFromStorage(provider, processedFilename, isS3);
      
      if (processedBuffer) {
        // Processed version exists, return it
        const cachedContentType =
          processedFilename.endsWith(".webp") ? "image/webp" :
          processedFilename.endsWith(".png") ? "image/png" :
          processedFilename.endsWith(".avif") ? "image/avif" :
          "image/jpeg";
        return {
          buffer: processedBuffer,
          contentType: cachedContentType,
          filePath: null,
          file: file,
          isS3: isS3
        };
      }

      // Process the image and store it
      const originalBuffer = await this.getFileBuffer(file, provider, isS3);
      const processedImage = await this.processImageBuffer(originalBuffer, {
        width,
        height,
        fit,
        quality,
        withoutEnlargement,
        format,
      });

      // Save processed image to the same storage adapter
      await this.saveProcessedToStorage(provider, processedFilename, processedImage.buffer);

      return {
        buffer: processedImage.buffer,
        contentType: processedImage.contentType || "image/jpeg",
        filePath: null,
        file: file,
        isS3: isS3
      };
    } else {
      // Non-image files
      const buffer = await this.getFileBuffer(file, provider, isS3);
      let filePath = null;
      
      // For video/audio files with local storage, provide file path for range requests
      if ((fileContentType.startsWith("video/") || fileContentType.startsWith("audio/")) && !isS3) {
        filePath = resolveStorageKey(provider.basePath, file.filename);
      }
      
      return {
        buffer,
        contentType: fileContentType,
        filePath,
        file: file,
        isS3: isS3
      };
    }
  }

  /**
   * Get file buffer from storage (works for both LOCAL and S3)
   */
  private async getFileBuffer(file: any, provider: any, isS3: boolean): Promise<Buffer> {
    if (isS3) {
      const stream = await provider.getFile(file.filename);
      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } else {
      const filePath = resolveStorageKey(provider.basePath, file.filename);
      return fs.promises.readFile(filePath);
    }
  }

  /**
   * Generate a filename for processed/resized images
   * Format: {originalName}_processed_{hash}.jpg
   */
  getProcessedFilename(originalFilename: string, query: AssetQuery): string {
    const cacheParams = {
      width: query.width,
      height: query.height,
      fit: query.fit,
      quality: query.quality,
      withoutEnlargement: query.withoutEnlargement,
      format: query.format,
    };
    const hash = crypto.createHash("md5").update(JSON.stringify(cacheParams)).digest("hex").substring(0, 8);
    const ext = path.extname(originalFilename);
    const baseName = path.basename(originalFilename, ext);
    const outputExt = query.format === "webp" ? "webp" : query.format === "png" ? "png" : query.format === "avif" ? "avif" : "jpg";
    return `${baseName}_processed_${hash}.${outputExt}`;
  }

  /**
   * Try to get a processed image from storage
   * Returns null if not found
   */
  private async getProcessedFromStorage(provider: any, filename: string, isS3: boolean): Promise<Buffer | null> {
    try {
      if (isS3) {
        const stream = await provider.getFile(filename);
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      } else {
        const filePath = resolveStorageKey(provider.basePath, filename);
        return await fs.promises.readFile(filePath);
      }
    } catch (error: any) {
      // File doesn't exist
      if (error.code === 'ENOENT' || error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      // For S3, check if it's a not found error
      if (error.Code === 'NoSuchKey' || error.message?.includes('NoSuchKey')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save processed image to storage
   */
  private async saveProcessedToStorage(provider: any, filename: string, buffer: Buffer): Promise<void> {
    try {
      await provider.saveFile(filename, buffer);
    } catch (error) {
      // Log but don't fail - the image is still returned to user
      console.error("Failed to save processed image to storage:", error);
    }
  }

  /**
   * Process image from buffer instead of file path.
   *
   * DoS hardening (A13): output width/height are clamped to a max, the decoder is
   * given a pixel limit (decompression-bomb defense), quality is clamped to 1–100,
   * and fit/format are validated against allowlists. Caps are configurable:
   *  - ASSET_MAX_DIMENSION  (default 5000)  — max output width/height in px
   *  - ASSET_MAX_INPUT_PIXELS (default 100_000_000 = 100MP) — sharp limitInputPixels
   */
  async processImageBuffer(
    inputBuffer: Buffer,
    { width, height, fit, quality, withoutEnlargement, format }: AssetQuery
  ): Promise<ProcessedImage> {
    const maxDimension = parseInt(env.get("ASSET_MAX_DIMENSION") || "5000");
    const maxInputPixels = parseInt(env.get("ASSET_MAX_INPUT_PIXELS") || "100000000");

    // Bound the decoder up front so a tiny "pixel bomb" can't exhaust memory.
    let image = sharp(inputBuffer, { limitInputPixels: maxInputPixels });

    // Clamp a requested dimension to [1, maxDimension]; undefined stays undefined.
    const clampDim = (v: string | number | undefined): number | undefined => {
      if (v === undefined || v === null || v === "") return undefined;
      const n = parseInt(v.toString(), 10);
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return Math.min(n, maxDimension);
    };

    const ALLOWED_FIT = new Set(["cover", "contain", "fill", "inside", "outside"]);
    const requestedFit = typeof fit === "string" && ALLOWED_FIT.has(fit) ? fit : "cover";

    const w = clampDim(width);
    const h = clampDim(height);
    if (w !== undefined || h !== undefined) {
      const resizeOptions: any = {
        width: w,
        height: h,
        fit: requestedFit,
        withoutEnlargement: withoutEnlargement === "true" || withoutEnlargement === true,
      };
      image = image.resize(resizeOptions);
    }

    // Clamp quality to the valid 1–100 range.
    const parsedQuality = quality ? parseInt(quality.toString(), 10) : 80;
    const outputQuality = Number.isFinite(parsedQuality)
      ? Math.min(100, Math.max(1, parsedQuality))
      : 80;

    // Validate format against the supported set; anything else falls back to jpeg.
    const ALLOWED_FORMATS = new Set(["jpeg", "jpg", "png", "webp", "avif"]);
    const requestedFormat = typeof format === "string" ? format.toLowerCase() : "";
    const outputFormat = ALLOWED_FORMATS.has(requestedFormat) ? requestedFormat : "jpeg";

    if (outputFormat === "webp") {
      image = image.webp({ quality: outputQuality });
      const buffer = await image.toBuffer();
      return { buffer, contentType: "image/webp" };
    } else if (outputFormat === "png") {
      image = image.png({ quality: outputQuality });
      const buffer = await image.toBuffer();
      return { buffer, contentType: "image/png" };
    } else if (outputFormat === "avif") {
      image = image.avif({ quality: outputQuality });
      const buffer = await image.toBuffer();
      return { buffer, contentType: "image/avif" };
    } else {
      // JPEG does not support transparency — flatten alpha to white background
      image = image.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: outputQuality });
      const buffer = await image.toBuffer();
      return { buffer, contentType: "image/jpeg" };
    }
  }

  /**
   * Delete processed/resized versions of an image when the original is deleted.
   * Overrides the no-op in FilesService.
   */
  protected async deleteProcessedVersions(file: any): Promise<void> {
    if (!file.type?.startsWith("image/")) return;

    const provider = this.storageService.getProvider(file.storage);
    const baseName = path.basename(file.filename, path.extname(file.filename));
    const pattern = `${baseName}_processed_`;

    try {
      if (provider.listFiles) {
        const files = await provider.listFiles(pattern);
        for (const f of files) {
          await provider.deleteFile(f);
        }
      }
    } catch (error) {
      console.error("Failed to delete processed versions:", error);
    }
  }
}

export default AssetsService;
