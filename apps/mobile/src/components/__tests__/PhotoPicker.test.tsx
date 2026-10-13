import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { act, fireEvent, screen } from "@testing-library/react-native";
import ar from "../../i18n/messages";
import { useOfflineSync } from "../../lib/offline-sync-context";
import type { AttendancePhoto } from "../../lib/photos";
import { expectArabicOnly, fill, renderInArabic } from "../../screens/__tests__/clock-screens-test-utils";
import { PhotoPicker } from "../PhotoPicker";

jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: jest.fn() }));
jest.mock("expo-image-picker", () => ({
  ...jest.requireActual("expo-image-picker"),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock("expo-image-manipulator", () => ({
  ...jest.requireActual("expo-image-manipulator"),
  ImageManipulator: { manipulate: jest.fn() },
}));

const GRANTED = { status: "granted", granted: true, canAskAgain: true, expires: "never" } as const;
const DENIED = { status: "denied", granted: false, canAskAgain: true, expires: "never" } as const;

let online = true;
let saved = 0;
let latest: AttendancePhoto[] = [];

/** A camera-sized photo from the picker. */
const asset = (name: string): ImagePicker.ImagePickerAsset => ({ uri: `file:///picker/${name}.jpg`, width: 4032, height: 3024 });
const picked = (...names: string[]) => ({ canceled: false as const, assets: names.map(asset) });

/** The picker inside a parent that keeps the list, like the clock screens do. */
function Harness({ initial = [], disabled = false }: { initial?: AttendancePhoto[]; disabled?: boolean }) {
  const [photos, setPhotos] = useState(initial);
  latest = photos;
  return <PhotoPicker photos={photos} onChange={setPhotos} disabled={disabled} />;
}

const existing = (count: number): AttendancePhoto[] =>
  Array.from({ length: count }, (_, i) => ({ key: `file:///cache/existing-${i + 1}.jpg`, uri: `file:///cache/existing-${i + 1}.jpg`, width: 1600, height: 1200 }));

beforeEach(() => {
  online = true;
  saved = 0;
  latest = [];
  jest.mocked(useOfflineSync).mockImplementation(() => ({ isOnline: online, pendingCount: 0, queue: [], queueOfflineEvent: jest.fn(), syncNow: jest.fn() }) as unknown as ReturnType<typeof useOfflineSync>);
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(GRANTED as unknown as ImagePicker.CameraPermissionResponse);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(picked("camera"));
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(picked("a", "b"));
  jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
    const context = {
      resize: jest.fn(),
      renderAsync: jest.fn(async () => ({
        width: 1600,
        height: 1200,
        saveAsync: jest.fn(async () => ({ uri: `file:///cache/compressed-${++saved}.jpg`, width: 1600, height: 1200 })),
        release: jest.fn(),
      })),
      release: jest.fn(),
    };
    context.resize.mockReturnValue(context);
    return context as never;
  });
});

const takeButton = () => screen.getByRole("button", { name: ar.photos.takePhoto });
const galleryButton = () => screen.getByRole("button", { name: ar.photos.pickFromGallery });
const count = (n: number) => fill(ar.photos.count, { count: String(n), max: "5" });

describe("PhotoPicker (Arabic, RTL)", () => {
  it("starts empty with the count out of 5 and both ways to add a photo", async () => {
    await renderInArabic(<Harness />);
    expect(screen.getByText(ar.photos.title)).toBeOnTheScreen();
    expect(screen.getByText(count(0))).toBeOnTheScreen();
    expect(screen.getByText("0 من 5")).toBeOnTheScreen();
    expect(takeButton()).toBeEnabled();
    expect(galleryButton()).toBeEnabled();
    expectArabicOnly();
  });

  it("takes a photo with the camera and compresses it before adding it (1600 px, JPEG 0.7)", async () => {
    await renderInArabic(<Harness />);
    await fireEvent.press(takeButton());

    expect(await screen.findByText(count(1))).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({ mediaTypes: ["images"], quality: 1, exif: false });
    expect(ImageManipulator.manipulate).toHaveBeenCalledWith("file:///picker/camera.jpg");
    const context = jest.mocked(ImageManipulator.manipulate).mock.results[0].value as { resize: jest.Mock; renderAsync: jest.Mock };
    expect(context.resize).toHaveBeenCalledWith({ width: 1600 });
    const image = (await context.renderAsync.mock.results[0].value) as { saveAsync: jest.Mock };
    expect(image.saveAsync).toHaveBeenCalledWith({ compress: 0.7, format: SaveFormat.JPEG });
    // The compressed file is the one kept (and later uploaded), not the camera original.
    expect(latest.map((p) => p.uri)).toEqual(["file:///cache/compressed-1.jpg"]);
    expect(screen.getByLabelText(fill(ar.photos.thumbnail, { index: "1" }))).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("asks for the camera permission and explains a refusal in Arabic", async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(DENIED as unknown as ImagePicker.CameraPermissionResponse);
    await renderInArabic(<Harness />);
    await fireEvent.press(takeButton());

    expect(await screen.findByText(ar.photos.cameraDenied)).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(screen.getByText(count(0))).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("picks several photos from the gallery, limited to the photos still allowed", async () => {
    await renderInArabic(<Harness initial={existing(2)} />);
    await fireEvent.press(galleryButton());

    expect(await screen.findByText(count(4))).toBeOnTheScreen();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 3, quality: 1, exif: false });
    expect(ImageManipulator.manipulate).toHaveBeenCalledTimes(2);
    expect(latest).toHaveLength(4);
  });

  it("never keeps more than 5 photos, even when the picker returns more", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(picked("a", "b", "c"));
    await renderInArabic(<Harness initial={existing(3)} />);
    await fireEvent.press(galleryButton());

    expect(await screen.findByText(count(5))).toBeOnTheScreen();
    expect(ImageManipulator.manipulate).toHaveBeenCalledTimes(2);
    expect(latest).toHaveLength(5);
  });

  it("at the limit of 5: says so and switches adding off", async () => {
    await renderInArabic(<Harness initial={existing(5)} />);

    expect(screen.getByText(count(5))).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.photos.limitReached, { max: "5" }))).toBeOnTheScreen();
    expect(screen.getByText("تم الوصول إلى الحد الأقصى (5 صور).")).toBeOnTheScreen();
    expect(takeButton()).toBeDisabled();
    expect(galleryButton()).toBeDisabled();
    await fireEvent.press(galleryButton());
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("removes a photo", async () => {
    await renderInArabic(<Harness initial={existing(2)} />);
    await fireEvent.press(screen.getByRole("button", { name: fill(ar.photos.remove, { index: "1" }) }));

    expect(screen.getByText(count(1))).toBeOnTheScreen();
    expect(latest.map((p) => p.key)).toEqual(["file:///cache/existing-2.jpg"]);
  });

  it("offline: says photos need the network and switches adding off (the photos already added stay)", async () => {
    online = false;
    await renderInArabic(<Harness initial={existing(1)} />);

    expect(screen.getByText(ar.photos.offline)).toBeOnTheScreen();
    expect(screen.getByText("إضافة الصور تحتاج إلى اتصال بالإنترنت.")).toBeOnTheScreen();
    expect(takeButton()).toBeDisabled();
    expect(galleryButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: fill(ar.photos.remove, { index: "1" }) })).toBeEnabled();
    expectArabicOnly();
  });

  it("says when a photo could not be prepared", async () => {
    jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
      throw new Error("decode failed");
    });
    await renderInArabic(<Harness />);
    await act(async () => {
      await fireEvent.press(takeButton());
    });

    expect(await screen.findByText(ar.photos.failed)).toBeOnTheScreen();
    expect(screen.getByText(count(0))).toBeOnTheScreen();
  });

  it("is switched off while the screen is sending", async () => {
    await renderInArabic(<Harness initial={existing(1)} disabled />);
    expect(takeButton()).toBeDisabled();
    expect(galleryButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: fill(ar.photos.remove, { index: "1" }) })).toBeDisabled();
  });
});
