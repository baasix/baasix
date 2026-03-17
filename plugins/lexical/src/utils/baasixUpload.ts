import type { Baasix } from '@baasix/sdk';

export async function uploadImageToBaasix(
  client: Baasix,
  file: File,
  folder?: string,
): Promise<string> {
  const result: any = await client.files.upload(file, {
    folder: folder || undefined,
  });
  const id =
    result?.id ||
    result?.data?.id ||
    (typeof result?.data === 'string' ? result.data : undefined) ||
    (typeof result === 'string' ? result : undefined);
  return client.files.getAssetUrl(id);
}
