import { Platform } from "react-native";
import { toUploadable, uploadPhotos, voiceFileInfo } from "../attachments";
import type { AttendancePhoto } from "../photos";

const photo = (n: number, assetId?: string): AttendancePhoto => ({ key: `file:///cache/${n}.jpg`, uri: `file:///cache/${n}.jpg`, width: 1600, height: 1200, assetId });

describe("attachments", () => {
  it("sends a local file as React Native's { uri, name, type } on the phone", async () => {
    expect(await toUploadable("file:///cache/1.jpg", "photo-1.jpg", "image/jpeg")).toEqual({ uri: "file:///cache/1.jpg", name: "photo-1.jpg", type: "image/jpeg" });
  });

  it("reads the file into a Blob on the web target", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({ blob: async () => blob } as Response);
    expect(await toUploadable("blob:http://localhost/1", "photo-1.jpg", "image/jpeg")).toBe(blob);
    expect(fetchSpy).toHaveBeenCalledWith("blob:http://localhost/1");
  });

  it("names the voice summary for its container: AAC in MP4 on the phone, WebM on the web", () => {
    expect(voiceFileInfo()).toEqual({ name: "voice-summary.m4a", type: "audio/mp4" });
    jest.replaceProperty(Platform, "OS", "web");
    expect(voiceFileInfo()).toEqual({ name: "voice-summary.webm", type: "audio/webm" });
  });

  it("uploads the photos one after another as ATTENDANCE_PHOTO, in order, with progress", async () => {
    let n = 0;
    const client = { uploadAttachment: jest.fn(async () => ({ fileAssetId: `asset-${++n}`, purpose: "ATTENDANCE_PHOTO" as const, contentType: "image/jpeg", sizeBytes: 1000 })) };
    const progress: string[] = [];
    const uploaded: string[] = [];

    const ids = await uploadPhotos(client, [photo(1), photo(2)], {
      onProgress: (current, total) => progress.push(`${current}/${total}`),
      onUploaded: (key, assetId) => uploaded.push(`${key}=${assetId}`),
    });

    expect(ids).toEqual(["asset-1", "asset-2"]);
    expect(client.uploadAttachment).toHaveBeenNthCalledWith(1, "ATTENDANCE_PHOTO", { uri: "file:///cache/1.jpg", name: "photo-1.jpg", type: "image/jpeg" }, "photo-1.jpg");
    expect(client.uploadAttachment).toHaveBeenNthCalledWith(2, "ATTENDANCE_PHOTO", { uri: "file:///cache/2.jpg", name: "photo-2.jpg", type: "image/jpeg" }, "photo-2.jpg");
    expect(progress).toEqual(["1/2", "2/2"]);
    expect(uploaded).toEqual(["file:///cache/1.jpg=asset-1", "file:///cache/2.jpg=asset-2"]);
  });

  it("never uploads a photo twice: one sent by an earlier attempt keeps its id", async () => {
    const client = { uploadAttachment: jest.fn(async () => ({ fileAssetId: "asset-new", purpose: "ATTENDANCE_PHOTO" as const, contentType: "image/jpeg", sizeBytes: 1000 })) };
    expect(await uploadPhotos(client, [photo(1, "asset-old"), photo(2)])).toEqual(["asset-old", "asset-new"]);
    expect(client.uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it("stops at the first failed upload and passes its error on", async () => {
    const failure = new Error("offline");
    const client = { uploadAttachment: jest.fn().mockRejectedValueOnce(failure) };
    await expect(uploadPhotos(client, [photo(1), photo(2)])).rejects.toBe(failure);
    expect(client.uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it("sends nothing without photos", async () => {
    const client = { uploadAttachment: jest.fn() };
    expect(await uploadPhotos(client, [])).toEqual([]);
    expect(client.uploadAttachment).not.toHaveBeenCalled();
  });
});
