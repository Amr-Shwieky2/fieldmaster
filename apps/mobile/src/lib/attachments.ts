import { Platform } from "react-native";
import type { FieldMasterClient, UploadableFile } from "@fieldmaster/api-client";
import type { AttendancePhoto } from "./photos";

/**
 * Files for `POST /attachments`. On iOS and Android, React Native's FormData
 * takes a `{ uri, name, type }` object and streams the local file. The web
 * target's FormData needs a real Blob, so the (blob: or data:) uri is read
 * first. Photos and voice notes always need the network: they are never put
 * in the offline queue (only the clock event's own fields are).
 */
export async function toUploadable(uri: string, name: string, type: string): Promise<UploadableFile> {
  if (Platform.OS !== "web") return { uri, name, type };
  const response = await fetch(uri);
  return response.blob();
}

/** The voice summary's file name and type: AAC in an MP4 container on the phone, WebM from the web target's recorder. */
export function voiceFileInfo(): { name: string; type: string } {
  return Platform.OS === "web" ? { name: "voice-summary.webm", type: "audio/webm" } : { name: "voice-summary.m4a", type: "audio/mp4" };
}

/**
 * Uploads the photos one after another (gentler on a weak connection) and
 * resolves with their asset ids, in order. A photo already uploaded by an
 * earlier attempt keeps its id and is not sent again. Throws what the first
 * failed upload threw (a NetworkError when offline).
 */
export async function uploadPhotos(
  client: Pick<FieldMasterClient, "uploadAttachment">,
  photos: AttendancePhoto[],
  callbacks: { onProgress?: (current: number, total: number) => void; onUploaded?: (key: string, assetId: string) => void } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, photo] of photos.entries()) {
    if (photo.assetId) {
      ids.push(photo.assetId);
      continue;
    }
    callbacks.onProgress?.(index + 1, photos.length);
    const name = `photo-${index + 1}.jpg`;
    const uploaded = await client.uploadAttachment("ATTENDANCE_PHOTO", await toUploadable(photo.uri, name, "image/jpeg"), name);
    callbacks.onUploaded?.(photo.key, uploaded.fileAssetId);
    ids.push(uploaded.fileAssetId);
  }
  return ids;
}
