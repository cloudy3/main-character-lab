import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, dataDir } from "./db";
import { assets, type Asset } from "./db/schema";
import { AppError, ProviderError } from "./errors";
export const MAX_UPLOAD = 20 * 1024 * 1024;
export function assetPath(relative: string) {
  const root = path.join(dataDir, "assets");
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(root + path.sep))
    throw new AppError("Invalid asset path.");
  return candidate;
}
export function getAsset(id: string): Asset {
  const item = db().select().from(assets).where(eq(assets.id, id)).get();
  if (!item) throw new AppError("This local file is no longer available.", 404);
  return item;
}
export async function readAsset(id: string) {
  try {
    return await readFile(assetPath(getAsset(id).path));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new AppError("This local file was deleted or moved.", 404);
    throw e;
  }
}
export async function storeAsset(
  buffer: Buffer,
  mime: string,
  purpose: string,
  dimensions?: { width: number; height: number },
): Promise<Asset> {
  const id = randomUUID();
  const ext =
    mime === "image/png"
      ? "png"
      : mime === "image/jpeg"
        ? "jpg"
        : mime === "application/zip"
          ? "zip"
          : mime === "application/json"
            ? "json"
            : "safetensors";
  const relative = `${id.slice(0, 2)}/${id}.${ext}`;
  const target = assetPath(relative);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target + ".tmp", buffer, { mode: 0o600 });
  await rename(target + ".tmp", target);
  const row: Asset = {
    id,
    path: relative,
    mime,
    purpose,
    size: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    createdAt: Date.now(),
  };
  db().insert(assets).values(row).run();
  return row;
}
export async function normalizeImage(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_UPLOAD)
    throw new AppError("Each photo must be between 1 byte and 20 MB.");
  try {
    const image = sharp(buffer, {
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const meta = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      (meta.pages ?? 1) > 1
    )
      throw new AppError("Use a still JPEG, PNG or WebP image.");
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 256)
      throw new AppError("Photos must be at least 256 pixels on each side.");
    return await image
      .rotate()
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#808080" })
      .jpeg({ quality: 95 })
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      "The image is corrupt, unsupported, or too large to decode.",
    );
  }
}
export async function storePhoto(file: File, purpose: string) {
  if (file.size > MAX_UPLOAD)
    throw new AppError("Each photo must be at most 20 MB.");
  const { data, info } = await normalizeImage(
    Buffer.from(await file.arrayBuffer()),
  );
  return storeAsset(data, "image/jpeg", purpose, info);
}
export async function removeAsset(id: string) {
  const asset = getAsset(id);
  await unlink(assetPath(asset.path)).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
  // Metadata remains to support immutable snapshots; bytes are removed.
}
export function validateRemoteUrl(url: string) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !(
      u.hostname === "fal.media" ||
      u.hostname.endsWith(".fal.media") ||
      u.hostname === "fal.ai" ||
      u.hostname.endsWith(".fal.ai")
    )
  ) {
    throw new ProviderError(
      "Provider returned an unsupported artifact host. No file was downloaded.",
      true,
    );
  }
  return u;
}
export async function fetchArtifact(
  url: string,
  maxBytes: number,
): Promise<Buffer> {
  let next = url;
  for (let redirects = 0; redirects < 4; redirects++) {
    validateRemoteUrl(next);
    const response = await fetch(next, {
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      next = new URL(response.headers.get("location") || "", next).href;
      continue;
    }
    if (!response.ok || !response.body)
      throw new ProviderError(
        `Artifact download failed (HTTP ${response.status}).`,
        response.status === 404 || response.status === 410,
      );
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new ProviderError(
        "Artifact exceeds the configured download limit.",
        true,
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes)
          throw new ProviderError(
            "Artifact exceeds the configured download limit.",
            true,
          );
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
  throw new ProviderError("Too many artifact redirects.", true);
}
export async function saveProviderImage(buffer: Buffer, purpose: string) {
  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: 20_000_000 })
      .png()
      .toBuffer({ resolveWithObject: true });
    return storeAsset(data, "image/png", purpose, info);
  } catch {
    throw new ProviderError("Provider returned an invalid image.", true);
  }
}
