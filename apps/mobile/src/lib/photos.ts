import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/**
 * Attendance photos are compressed on the phone before they are uploaded:
 * the long side is at most PHOTO_MAX_EDGE pixels, saved as JPEG at
 * PHOTO_JPEG_QUALITY. A 12-megapixel camera photo (4 MB and more) becomes a
 * few hundred kilobytes, which matters on a building site's mobile data.
 * Re-encoding also drops the camera's metadata (the server strips it too).
 */
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.7;

/** A photo the worker added: the compressed local file, and its upload once sent. */
export interface AttendancePhoto {
  /** Stable key for the list (the compressed file's uri is unique). */
  key: string;
  uri: string;
  width: number;
  height: number;
  /** Set after `POST /attachments`, so a retry never uploads the same photo twice. */
  assetId?: string;
}

/** The resize that brings the long side down to PHOTO_MAX_EDGE (keeping the ratio), or null when it already fits. */
export function resizeFor(width: number, height: number): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0) || Math.max(width, height) <= PHOTO_MAX_EDGE) return null;
  return width >= height ? { width: PHOTO_MAX_EDGE } : { height: PHOTO_MAX_EDGE };
}

type Releasable = { release?: () => void };
const release = (value: unknown) => (value as Releasable | null)?.release?.();

/** Resizes and re-encodes one picked photo; resolves with the new local file. */
export async function compressPhoto(asset: { uri: string; width?: number | null; height?: number | null }): Promise<AttendancePhoto> {
  let width = asset.width ?? 0;
  let height = asset.height ?? 0;
  let source: Parameters<typeof ImageManipulator.manipulate>[0] = asset.uri;
  let original: unknown = null;
  if (!(width > 0 && height > 0)) {
    // The picker did not give the size (some web files): render once to read it.
    const rendered = await ImageManipulator.manipulate(asset.uri).renderAsync();
    original = rendered;
    width = rendered.width;
    height = rendered.height;
    source = rendered;
  }
  const context = ImageManipulator.manipulate(source);
  try {
    const resize = resizeFor(width, height);
    if (resize) context.resize(resize);
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({ compress: PHOTO_JPEG_QUALITY, format: SaveFormat.JPEG });
      return { key: saved.uri, uri: saved.uri, width: saved.width, height: saved.height };
    } finally {
      release(image);
    }
  } finally {
    release(context);
    release(original);
  }
}
