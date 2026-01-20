import type { HttpClient } from "../client";
import type {
  AssetTransformOptions,
  FileMetadata,
  PaginatedResponse,
  QueryParams,
  UploadOptions,
} from "../types";

export interface FilesModuleConfig {
  client: HttpClient;
}

/**
 * Files module for file upload, management, and asset transformations.
 *
 * @example
 * ```typescript
 * // Upload a file
 * const file = await baasix.files.upload(fileInput.files[0], {
 *   title: 'My Image',
 *   isPublic: true
 * });
 *
 * // Get asset URL with transformations
 * const url = baasix.files.getAssetUrl(file.id, {
 *   width: 200,
 *   height: 200,
 *   fit: 'cover'
 * });
 * ```
 */
export class FilesModule {
  private client: HttpClient;

  constructor(config: FilesModuleConfig) {
    this.client = config.client;
  }

  /**
   * Upload a file
   *
   * @example
   * ```typescript
   * // Browser File API
   * const metadata = await baasix.files.upload(fileInput.files[0], {
   *   title: 'Product Image',
   *   folder: 'products',
   *   isPublic: true,
   *   onProgress: (progress) => console.log(`${progress}% uploaded`)
   * });
   *
   * // React Native with expo-image-picker
   * const metadata = await baasix.files.upload({
   *   uri: result.uri,
   *   name: 'photo.jpg',
   *   type: 'image/jpeg'
   * });
   * ```
   */
  async upload(
    file: File | Blob | { uri: string; name: string; type: string },
    options?: UploadOptions
  ): Promise<FileMetadata> {
    const formData = new FormData();

    // Handle different file types (Browser File, Blob, React Native)
    if (file instanceof File || file instanceof Blob) {
      formData.append("file", file);
    } else {
      // React Native style object with uri
      formData.append("file", file as unknown as Blob);
    }

    // Add metadata options
    if (options?.title) {
      formData.append("title", options.title);
    }
    if (options?.description) {
      formData.append("description", options.description);
    }
    if (options?.folder) {
      formData.append("folder", options.folder);
    }
    if (options?.storage) {
      formData.append("storage", options.storage);
    }
    if (options?.isPublic !== undefined) {
      formData.append("isPublic", String(options.isPublic));
    }
    if (options?.metadata) {
      formData.append("metadata", JSON.stringify(options.metadata));
    }

    const response = await this.client.upload<{ data: FileMetadata }>(
      "/files",
      formData,
      { 
        onProgress: options?.onProgress,
        timeout: options?.timeout 
      }
    );

    return response.data;
  }

  /**
   * Upload multiple files
   *
   * @example
   * ```typescript
   * const files = await baasix.files.uploadMany(fileInput.files, {
   *   folder: 'gallery',
   *   isPublic: true
   * });
   * ```
   */
  async uploadMany(
    files: FileList | File[] | Array<{ uri: string; name: string; type: string }>,
    options?: Omit<UploadOptions, "onProgress">
  ): Promise<FileMetadata[]> {
    const results: FileMetadata[] = [];
    
    // Handle different input types
    const fileArray: Array<File | { uri: string; name: string; type: string }> = 
      files instanceof FileList 
        ? Array.from(files) 
        : files;

    for (const file of fileArray) {
      const metadata = await this.upload(file, options);
      results.push(metadata);
    }

    return results;
  }

  /**
   * List files with optional filtering
   *
   * @example
   * ```typescript
   * const { data, totalCount } = await baasix.files.find({
   *   filter: { mimeType: { startsWith: 'image/' } },
   *   limit: 20
   * });
   * ```
   */
  async find(params?: QueryParams): Promise<PaginatedResponse<FileMetadata>> {
    return this.client.get<PaginatedResponse<FileMetadata>>("/files", {
      params: params as Record<string, unknown>,
    });
  }

  /**
   * Get file metadata by ID
   *
   * @example
   * ```typescript
   * const file = await baasix.files.findOne('file-uuid');
   * console.log(file.filename, file.size);
   * ```
   */
  async findOne(id: string): Promise<FileMetadata> {
    const response = await this.client.get<{ data: FileMetadata }>(`/files/${id}`);
    return response.data;
  }

  /**
   * Update file metadata
   *
   * @example
   * ```typescript
   * await baasix.files.update('file-uuid', {
   *   title: 'Updated Title',
   *   description: 'New description'
   * });
   * ```
   */
  async update(
    id: string,
    data: Partial<Pick<FileMetadata, "title" | "description" | "isPublic">>
  ): Promise<FileMetadata> {
    const response = await this.client.patch<{ data: FileMetadata }>(
      `/files/${id}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a file
   *
   * @example
   * ```typescript
   * await baasix.files.delete('file-uuid');
   * ```
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/files/${id}`);
  }

  /**
   * Delete multiple files
   *
   * @example
   * ```typescript
   * await baasix.files.deleteMany(['id1', 'id2', 'id3']);
   * ```
   */
  async deleteMany(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.delete(id)));
  }

  /**
   * Get the URL for an asset with optional transformations
   *
   * @example
   * ```typescript
   * // Original file
   * const url = baasix.files.getAssetUrl('file-uuid');
   *
   * // Resized thumbnail
   * const thumbUrl = baasix.files.getAssetUrl('file-uuid', {
   *   width: 200,
   *   height: 200,
   *   fit: 'cover',
   *   quality: 80
   * });
   *
   * // Convert to WebP
   * const webpUrl = baasix.files.getAssetUrl('file-uuid', {
   *   format: 'webp',
   *   quality: 85
   * });
   * ```
   */
  getAssetUrl(id: string, options?: AssetTransformOptions): string {
    const baseUrl = this.client.getBaseUrl();
    const url = new URL(`/assets/${id}`, baseUrl);

    if (options) {
      if (options.width) {
        url.searchParams.set("width", String(options.width));
      }
      if (options.height) {
        url.searchParams.set("height", String(options.height));
      }
      if (options.fit) {
        url.searchParams.set("fit", options.fit);
      }
      if (options.quality) {
        url.searchParams.set("quality", String(options.quality));
      }
      if (options.format) {
        url.searchParams.set("format", options.format);
      }
    }

    return url.toString();
  }

  /**
   * Download a file as a Blob
   *
   * @example
   * ```typescript
   * const blob = await baasix.files.download('file-uuid');
   *
   * // Create download link
   * const url = URL.createObjectURL(blob);
   * const a = document.createElement('a');
   * a.href = url;
   * a.download = 'filename.pdf';
   * a.click();
   * ```
   */
  async download(id: string, options?: AssetTransformOptions): Promise<Blob> {
    const url = this.getAssetUrl(id, options);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    return response.blob();
  }

  /**
   * Get file as base64 string (useful for React Native)
   *
   * @example
   * ```typescript
   * const base64 = await baasix.files.toBase64('file-uuid');
   * // Use in Image component: <Image source={{ uri: `data:image/jpeg;base64,${base64}` }} />
   * ```
   */
  async toBase64(id: string, options?: AssetTransformOptions): Promise<string> {
    const blob = await this.download(id, options);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Remove data URL prefix
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Import file from URL
   *
   * @example
   * ```typescript
   * const file = await baasix.files.importFromUrl(
   *   'https://example.com/image.jpg',
   *   { title: 'Imported Image' }
   * );
   * ```
   */
  async importFromUrl(
    url: string,
    options?: UploadOptions
  ): Promise<FileMetadata> {
    const response = await this.client.post<{ data: FileMetadata }>(
      "/files/import",
      {
        url,
        ...options,
      }
    );
    return response.data;
  }
}

// Re-export types
export type { AssetTransformOptions, FileMetadata, UploadOptions };
