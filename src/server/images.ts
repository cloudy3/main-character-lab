import "server-only";
import sharp from "sharp";
import { AppError } from "./errors";
import { getAsset, readAsset, storeAsset } from "./storage";
export async function expandedMask(
  bytes: Buffer,
  width: number,
  height: number,
) {
  return sharp(bytes, { limitInputPixels: 40_000_000 })
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .threshold(32)
    .blur(Math.max(3, Math.min(width, height) * 0.015))
    .threshold(5)
    .png()
    .toBuffer();
}
export async function sanitizeReference(assetId: string, maskBytes: Buffer) {
  try {
    const metadata = await sharp(maskBytes, {
      limitInputPixels: 40_000_000,
    }).metadata();
    if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1)
      throw new Error("Unsupported mask");
  } catch {
    throw new AppError("The face mask must be a valid, still PNG image.");
  }
  const original = getAsset(assetId);
  const width = original.width!;
  const height = original.height!;
  const mask = await sharp(maskBytes, { limitInputPixels: 40_000_000 })
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .removeAlpha()
    .threshold(127)
    .raw()
    .toBuffer();
  const selected = mask.filter((x) => x > 127).length / mask.length;
  if (selected < 0.001)
    throw new AppError(
      "Paint over the reference person's face before continuing.",
    );
  if (selected > 0.65)
    throw new AppError(
      "The mask covers too much of the photograph. Mask the face, keeping clothing and background visible.",
    );
  const originalBytes = await sharp(await readAsset(assetId))
    .removeAlpha()
    .raw()
    .toBuffer();
  // A solid replacement removes spatial facial details inside the selected area.
  for (let i = 0; i < mask.length; i++)
    if (mask[i] > 127) {
      originalBytes[i * 3] = 127;
      originalBytes[i * 3 + 1] = 127;
      originalBytes[i * 3 + 2] = 127;
    }
  const sanitized = await sharp(originalBytes, {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
  const pngMask = await sharp(mask, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return {
    sanitized: await storeAsset(sanitized, "image/png", "sanitized-reference", {
      width,
      height,
    }),
    mask: await storeAsset(pngMask, "image/png", "face-mask", {
      width,
      height,
    }),
  };
}
export async function transformedAsset(
  id: string,
  width: number,
  height: number,
  purpose: string,
) {
  const data = await sharp(await readAsset(id))
    .resize(width, height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return storeAsset(data, "image/png", purpose, { width, height });
}
