import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, logError, safeError } from "./errors";
export function guard(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  const hostname = host.replace(/:\d+$/, "");
  const allowedHost = process.env.APP_ORIGIN
    ? new URL(process.env.APP_ORIGIN).host
    : null;
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(hostname) &&
    host !== allowedHost
  )
    throw new AppError("Untrusted host.", 403);
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (
      !origin ||
      (origin !== `${url.protocol}//${host}` &&
        origin !== process.env.APP_ORIGIN) ||
      fetchSite === "cross-site"
    )
      throw new AppError("Untrusted request origin.", 403);
  }
}
export async function api(
  request: Request,
  action: () => Promise<unknown> | unknown,
) {
  try {
    guard(request);
    const result = await action();
    return result instanceof Response
      ? result
      : NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
            .join("; "),
        },
        { status: 400 },
      );
    logError("api_failed", error);
    return NextResponse.json(
      { error: safeError(error) },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
export async function json(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("Expected JSON.", 415);
  try {
    return JSON.parse((await readLimited(request, 32 * 1024)).toString());
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Malformed JSON.");
  }
}
async function readLimited(request: Request, limit: number) {
  if (!request.body || Number(request.headers.get("content-length")) > limit)
    throw new AppError("Request exceeds the size limit.", 413);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > limit)
        throw new AppError("Request exceeds the size limit.", 413);
      chunks.push(r.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export async function uploadedFile(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data"))
    throw new AppError("Expected a file upload.", 415);
  const bytes = await readLimited(request, 21 * 1024 * 1024);
  const form = await new Response(bytes, {
    headers: { "Content-Type": contentType },
  }).formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("Choose an image file.");
  return file;
}
export function requestKey(request: Request) {
  const key = request.headers.get("idempotency-key");
  if (!key) throw new AppError("A request key is required.");
  return key;
}
