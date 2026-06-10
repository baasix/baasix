import type { Express } from "../types/index.js";
import FilesService from "../services/FilesService.js";
import AssetsService from "../services/AssetsService.js";
import SettingsService from "../services/SettingsService.js";
import fileUpload from "express-fileupload";
import { APIError } from "../utils/errorHandler.js";
import { parseQueryParams } from "../utils/router.js";
import env from "../utils/env.js";
import fs from "fs";
import axios from "axios";

/**
 * Content types that must NEVER be served inline from the app origin, because a
 * browser would execute scripts in them → stored XSS. The file `type` is set from
 * the client's upload, so it cannot be trusted to be a safe media type.
 * These are forced to download (attachment) with a neutral content-type.
 */
const UNSAFE_INLINE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "text/ecmascript",
]);

function isUnsafeInlineType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  // Strip any charset/parameters: "text/html; charset=utf-8" → "text/html"
  const base = contentType.split(";")[0].trim().toLowerCase();
  return UNSAFE_INLINE_TYPES.has(base);
}

const registerEndpoint = (app: Express) => {
  // Maximum file upload size in MB (default: 50MB)
  const maxFileSizeMB = parseInt(env.get("MAX_UPLOAD_FILE_SIZE") || "50");
  const maxFileSize = maxFileSizeMB * 1024 * 1024;

  // Middleware to initialize FileService
  const initFileService = (req: any, res: any, next: any) => {
    req.filesService = new FilesService({
      accountability: req.accountability,
    });
    next();
  };

  // Get all files
  app.get("/files", initFileService, async (req: any, res, next) => {
    try {
      const query = parseQueryParams(req.query);
      const result = await req.filesService.itemService.readByQuery(query);
      res.status(200).json(result);
    } catch (error) {
      console.error(error);
      next(error);
    }
  });

  // Get single file
  app.get("/files/:id", initFileService, async (req: any, res, next) => {
    try {
      const file = await req.filesService.readOne(req.params.id, req.query);
      res.status(200).json({ data: file });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });

  // Create file
  app.post(
    "/files",
    initFileService,
    fileUpload({ limits: { fileSize: maxFileSize } }),
    async (req: any, res, next) => {
      try {
        if (!req.files || !req.files.file) {
          return res.status(400).json({ message: "No file uploaded. Please provide a file with the field name 'file'." });
        }
        const file = req.files.file;
        const metadata = {
          ...req.body,
          title: req.body.title || file.name,
          storage: req.body.storage || env.get("STORAGE_DEFAULT_SERVICE"),
        };
        const createdFile = await req.filesService.createOne({ file }, metadata);
        res.status(200).json({ data: createdFile });
      } catch (error) {
        console.error(error);
        next(error);
      }
    }
  );

  // Update file
  app.patch(
    "/files/:id",
    initFileService,
    fileUpload({ limits: { fileSize: maxFileSize } }),
    async (req: any, res, next) => {
      try {
        const file = req.files?.file;
        const metadata = req.body;
        const updatedFile = await req.filesService.updateOne(req.params.id, { file }, metadata);
        res.status(200).json({ data: updatedFile });
      } catch (error) {
        console.error(error);
        next(error);
      }
    }
  );

  // Delete file
  app.delete("/files/:id", initFileService, async (req: any, res, next) => {
    try {
      await req.filesService.deleteOne(req.params.id);
      res.status(200).json({ message: "File deleted successfully" });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });

  // Upload file from URL
  app.post("/files/upload-from-url", initFileService, async (req: any, res, next) => {
    try {
      const { url, ...metadata } = req.body;
      const file = await req.filesService.uploadFromUrl(url, metadata);
      res.status(200).json({ data: file });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });

  // Get asset (with image processing support)
  app.get("/assets/:id", initFileService, async (req: any, res, next) => {
    try {
      const isDownload = req.query.download === "true";
      const assetService = new AssetsService({
        accountability: req.accountability,
      });

      let fileId = req.params.id;
      let bypassPermissions = false;

      // Handle special project asset names
      if (
        ["project_logo_light", "project_logo_dark", "project_favicon", "project_icon", "email_icon"].includes(
          req.params.id
        )
      ) {
        const settings = await SettingsService.getSettings();
        const file = (settings as any)[req.params.id];

        if (file) {
          fileId = file.id;
          bypassPermissions = true;
        } else {
          res.status(404).send("File not found");
          return;
        }
      }

      const { buffer, contentType, filePath, file, isS3 } = await assetService.getAsset(
        fileId,
        req.query,
        bypassPermissions
      );

      // Helper function to get download filename with proper encoding
      const getDownloadHeaders = (file: any) => {
        const downloadFilename = file.originalFilename || file.title || file.filename;
        const encodedFilename = encodeURIComponent(downloadFilename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
        return `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`;
      };

      // Check if transform params were requested (resize, quality)
      const hasTransformParams = req.query.width || req.query.height || req.query.quality;

      // For S3 files WITHOUT transform params, handle secure proxy or direct redirect
      // If transform params exist, we use the processed buffer from getAsset() instead
      if (isS3 && !isDownload && !hasTransformParams) {
        try {
          const provider = (assetService as any).storageService.getProvider(file.storage);

          if (env.get("ASSET_PROXY_ENABLED") === "true") {
            // Parse ASSET_SECURE_PROXY_URLS as array of file types
            const secureFileTypes = env.get("ASSET_SECURE_PROXY_URLS")
              ? env.get("ASSET_SECURE_PROXY_URLS").split(",").map((type: string) => type.trim().toLowerCase())
              : [];

            // Check if current file type requires secure proxy
            const requiresSecureProxy = secureFileTypes.some((type: string) => {
              if (type === "video" && contentType.startsWith("video/")) return true;
              if (type === "audio" && contentType.startsWith("audio/")) return true;
              if (type === "image" && contentType.startsWith("image/")) return true;
              if (contentType.startsWith(type + "/")) return true;
              return false;
            });

            if (requiresSecureProxy) {
              // Require an authenticated user AND a custom request header. The header
              // is an ANTI-HOTLINKING control, not an auth check: browsers cannot
              // set custom headers on passive embeds (<img>/<video>/<audio> src), so
              // requiring `x-baasix-user-auth` forces the request to come from an
              // SDK / fetch caller rather than a direct in-page embed. (Auth itself
              // comes from req.accountability via the verified session.)
              if (!req.accountability?.user?.id) {
                return res.status(401).json({ error: "Authentication required" });
              }
              const userId = req.accountability.user.id.toString();
              const providedAuth = req.headers["x-baasix-user-auth"];
              if (providedAuth !== userId) {
                return res.status(403).json({ error: "Invalid or missing authentication header" });
              }
            }

            // Stream from S3 through server with range support
            const presignedUrl = await provider.getPublicUrl(file.filename);

            const requestHeaders: any = {};
            if (req.headers.range) {
              requestHeaders.range = req.headers.range;
            }

            const s3Response = await axios({
              method: "GET",
              url: presignedUrl,
              headers: requestHeaders,
              responseType: "stream",
              validateStatus: (status: number) => status < 400,
            });

            // Forward S3 response headers
            // Use our contentType (from database) instead of S3's content-type
            // S3 may have octet-stream if file was uploaded without extension
            res.set({
              "Content-Type": contentType,
              "Content-Length": s3Response.headers["content-length"],
              "Accept-Ranges": "bytes",
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Content-Disposition": isDownload ? getDownloadHeaders(file) : "inline",
            });

            if (s3Response.headers["content-range"]) {
              res.set("Content-Range", s3Response.headers["content-range"]);
              res.status(206);
            }

            s3Response.data.pipe(res);
            return;
          } else {
            // Direct redirect for non-secure file types or unauthenticated users
            if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
              const presignedUrl = await provider.getPublicUrl(file.filename);
              res.redirect(302, presignedUrl);
              return;
            }
          }
        } catch (error) {
          console.error("Failed to handle S3 file request, falling back to proxy:", error);
          // Fall through to normal handling if S3 handling fails
        }
      }

      // Handle S3 file downloads - stream through server with correct filename
      if (isS3 && isDownload) {
        try {
          const provider = (assetService as any).storageService.getProvider(file.storage);
          const presignedUrl = await provider.getPublicUrl(file.filename);

          const s3Response = await axios({
            method: "GET",
            url: presignedUrl,
            responseType: "stream",
            validateStatus: (status: number) => status < 400,
          });

          const downloadFilename = file.originalFilename || file.title || file.filename;
          
          // Use res.attachment() which properly sets Content-Disposition
          res.attachment(downloadFilename);
          // Use our contentType (from database) instead of S3's content-type
          res.setHeader("Content-Type", contentType);
          res.setHeader("Content-Length", s3Response.headers["content-length"]);

          s3Response.data.pipe(res);
          return;
        } catch (error) {
          console.error("Failed to handle S3 download, falling back to buffer:", error);
          // Fall through to normal handling if S3 handling fails
        }
      }

      // Handle range requests for local video files
      if (
        contentType &&
        (contentType.startsWith("video/") || contentType.startsWith("audio/")) &&
        filePath &&
        !isS3
      ) {
        const range = req.headers.range;

        if (range) {
          const stat = await fs.promises.stat(filePath);
          const fileSize = stat.size;
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = end - start + 1;

          const stream = fs.createReadStream(filePath, { start, end });

          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
          });

          stream.pipe(res);
          return;
        }

        // If not a range request, set Accept-Ranges header for video files
        res.setHeader("Accept-Ranges", "bytes");
      }

      // Never let the browser sniff a different (executable) type than declared.
      // Configurable: set ASSET_NOSNIFF=false to omit the header.
      if (env.get("ASSET_NOSNIFF") !== "false") {
        res.setHeader("X-Content-Type-Options", "nosniff");
      }

      // Stored-XSS guard for executable types. Configurable: ASSET_XSS_PROTECTION=false
      // disables forcing html/svg/js to download (NOT recommended).
      const xssProtectionEnabled = env.get("ASSET_XSS_PROTECTION") !== "false";
      const unsafeInline = xssProtectionEnabled && isUnsafeInlineType(contentType);

      if (unsafeInline) {
        // Stored-XSS guard: types the browser would execute (html/svg/js/xml) are
        // forced to download with a neutral type, never rendered in the app origin.
        res.contentType("application/octet-stream");
        res.setHeader("Content-Disposition", getDownloadHeaders(file));
      } else {
        res.contentType(contentType);
        if (isDownload) {
          res.setHeader("Content-Disposition", getDownloadHeaders(file));
        } else {
          // Explicitly set inline disposition for viewing in browser
          res.setHeader("Content-Disposition", "inline");
        }
      }

      res.send(buffer);
    } catch (error) {
      console.error(error);
      next(error);
    }
  });
};

export default {
  id: "files",
  handler: registerEndpoint,
};
