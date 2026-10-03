import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api, json, requestKey, uploadedFile } from "@/server/http";
import * as service from "@/server/services";
import { configuredProvider, provider } from "@/server/providers";
import { getAsset, readAsset } from "@/server/storage";
import { AppError } from "@/server/errors";
import { jobAction, startReconciler } from "@/server/jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
export async function GET(request: NextRequest, context: Context) {
  return api(request, async () => {
    startReconciler();
    const { path = [] } = await context.params;
    if (path[0] === "status")
      return {
        provider: configuredProvider(),
        configured:
          configuredProvider() === "mock" || Boolean(process.env.FAL_KEY),
        capabilities: provider().capabilities,
      };
    if (path[0] === "identities") return service.library();
    if (path[0] === "history")
      return service.history(
        request.nextUrl.searchParams.get("identity") || undefined,
        Number(request.nextUrl.searchParams.get("before")) || undefined,
      );
    if (path[0] === "generations" && path[1])
      return service.generationView(path[1]);
    if (path[0] === "references" && path[1]) {
      const ref = service.getReference(path[1]);
      return {
        ...ref,
        asset: getAsset(ref.assetId),
        jobs: service.referenceJobViews(ref.id),
      };
    }
    if (path[0] === "assets" && path[1]) {
      const asset = getAsset(path[1]);
      const download =
        request.nextUrl.searchParams.has("download") ||
        !asset.mime.startsWith("image/");
      return new NextResponse(new Uint8Array(await readAsset(asset.id)), {
        headers: {
          "Content-Type": asset.mime,
          "Content-Length": String(asset.size),
          "Cache-Control": "private, no-store",
          "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asset.id}.${asset.path.split(".").at(-1)}"`,
        },
      });
    }
    throw new AppError("Endpoint not found.", 404);
  });
}
export async function POST(request: NextRequest, context: Context) {
  return api(request, async () => {
    startReconciler();
    const { path = [] } = await context.params;
    if (path[0] === "identities" && path.length === 1) {
      const body = z.object({ name: z.string() }).parse(await json(request));
      return service.createIdentity(body.name);
    }
    if (path[0] === "identities" && path[1] && path[2] === "photos")
      return service.addPhoto(path[1], await uploadedFile(request));
    if (path[0] === "identities" && path[1] && path[2] === "train")
      return {
        id: service.startTraining(
          path[1],
          await json(request),
          requestKey(request),
        ),
      };
    if (path[0] === "references" && path.length === 1)
      return service.uploadReference(await uploadedFile(request));
    if (path[0] === "references" && path[1] && path[2] === "prepare")
      return { id: service.prepareReference(path[1], requestKey(request)) };
    if (path[0] === "references" && path[1] && path[2] === "mask") {
      const file = await uploadedFile(request);
      await service.approveMask(path[1], Buffer.from(await file.arrayBuffer()));
      return { ok: true };
    }
    if (path[0] === "generations")
      return {
        id: service.startGeneration(await json(request), requestKey(request)),
      };
    if (path[0] === "jobs" && path[1]) {
      const input = z
        .object({
          action: z.enum(["retry", "attach", "cancel", "abandon"]),
          requestId: z.string().optional(),
        })
        .parse(await json(request));
      await jobAction(path[1], input.action, input.requestId);
      return { ok: true };
    }
    throw new AppError("Endpoint not found.", 404);
  });
}
export async function DELETE(request: NextRequest, context: Context) {
  return api(request, async () => {
    const { path = [] } = await context.params;
    if (path[0] === "identities" && path[1]) {
      if (path[2] === "photos" && path[3])
        service.removePhoto(path[1], path[3]);
      else if (path.length === 2) await service.deleteIdentity(path[1]);
      else throw new AppError("Endpoint not found.", 404);
      return { ok: true };
    }
    throw new AppError("Endpoint not found.", 404);
  });
}
