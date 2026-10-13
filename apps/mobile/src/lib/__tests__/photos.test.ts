import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { MAX_ATTENDANCE_PHOTOS } from "@fieldmaster/shared-types";
import { PHOTO_JPEG_QUALITY, PHOTO_MAX_EDGE, compressPhoto, resizeFor } from "../photos";

jest.mock("expo-image-manipulator", () => ({
  ...jest.requireActual("expo-image-manipulator"),
  ImageManipulator: { manipulate: jest.fn() },
}));

/** A fake manipulation context: records the resize, renders to an image of `rendered` size, saves to `saved`. */
function fakeContext(rendered: { width: number; height: number }, saved = { uri: "file:///cache/compressed.jpg", width: 1600, height: 1200 }) {
  const image = { ...rendered, saveAsync: jest.fn(async () => saved), release: jest.fn() };
  const context = { resize: jest.fn(), renderAsync: jest.fn(async () => image), release: jest.fn() };
  context.resize.mockReturnValue(context);
  return { context, image };
}

describe("photo compression", () => {
  it("is set to about 1600 px on the long side and JPEG quality 0.7, for at most 5 photos", () => {
    expect(PHOTO_MAX_EDGE).toBe(1600);
    expect(PHOTO_JPEG_QUALITY).toBe(0.7);
    expect(MAX_ATTENDANCE_PHOTOS).toBe(5);
  });

  it("brings the long side down to 1600 px, keeping the ratio", () => {
    expect(resizeFor(4000, 3000)).toEqual({ width: 1600 });
    expect(resizeFor(3000, 4000)).toEqual({ height: 1600 });
    expect(resizeFor(4000, 4000)).toEqual({ width: 1600 });
  });

  it("does not enlarge a photo that already fits, or one without a known size", () => {
    expect(resizeFor(1600, 1200)).toBeNull();
    expect(resizeFor(800, 600)).toBeNull();
    expect(resizeFor(0, 0)).toBeNull();
  });

  it("resizes a camera photo and saves it as JPEG at quality 0.7", async () => {
    const { context, image } = fakeContext({ width: 1600, height: 1200 });
    jest.mocked(ImageManipulator.manipulate).mockReturnValue(context as never);

    const photo = await compressPhoto({ uri: "file:///camera/IMG_0001.jpg", width: 4032, height: 3024 });

    expect(ImageManipulator.manipulate).toHaveBeenCalledWith("file:///camera/IMG_0001.jpg");
    expect(context.resize).toHaveBeenCalledWith({ width: 1600 });
    expect(image.saveAsync).toHaveBeenCalledWith({ compress: 0.7, format: SaveFormat.JPEG });
    expect(photo).toEqual({ key: "file:///cache/compressed.jpg", uri: "file:///cache/compressed.jpg", width: 1600, height: 1200 });
    // Native memory is released.
    expect(context.release).toHaveBeenCalled();
    expect(image.release).toHaveBeenCalled();
  });

  it("re-encodes a small photo without resizing it", async () => {
    const { context, image } = fakeContext({ width: 900, height: 1200 }, { uri: "file:///cache/small.jpg", width: 900, height: 1200 });
    jest.mocked(ImageManipulator.manipulate).mockReturnValue(context as never);

    await compressPhoto({ uri: "file:///gallery/small.png", width: 900, height: 1200 });

    expect(context.resize).not.toHaveBeenCalled();
    expect(image.saveAsync).toHaveBeenCalledWith({ compress: 0.7, format: SaveFormat.JPEG });
  });

  it("reads the size first when the picker did not give it (some web files)", async () => {
    const first = fakeContext({ width: 3000, height: 5000 });
    const second = fakeContext({ width: 960, height: 1600 }, { uri: "file:///cache/portrait.jpg", width: 960, height: 1600 });
    jest.mocked(ImageManipulator.manipulate).mockReturnValueOnce(first.context as never).mockReturnValueOnce(second.context as never);

    const photo = await compressPhoto({ uri: "blob:http://localhost/1", width: 0, height: 0 });

    expect(ImageManipulator.manipulate).toHaveBeenNthCalledWith(1, "blob:http://localhost/1");
    // The rendered original is the source of the resize.
    expect(ImageManipulator.manipulate).toHaveBeenNthCalledWith(2, first.image);
    expect(second.context.resize).toHaveBeenCalledWith({ height: 1600 });
    expect(photo.uri).toBe("file:///cache/portrait.jpg");
  });
});
