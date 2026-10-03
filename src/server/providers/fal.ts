import "server-only";
import { trainingEstimate, generationEstimate } from "@/domain/controls";
import { createFalClient } from "@fal-ai/client";
import { z } from "zod";
import type { AIProvider } from "./types";
import type { JobKind, ProviderResult } from "@/domain/types";
import { AppError, ProviderError } from "../errors";
import { fetchArtifact } from "../storage";
import { buildFluxInput } from "./flux-input";
export const FAL_ENDPOINTS = {
  training: "fal-ai/flux-lora-fast-training",
  generation: "fal-ai/flux-general/image-to-image",
  pose: "fal-ai/dwpose",
  mask: "fal-ai/dwpose",
} as const;
const artifact = z.object({
  url: z.string().url(),
  content_type: z.string().optional(),
});
function providerError(error: unknown): ProviderError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number(error.status)
      : 0;
  if (status === 401 || status === 403)
    return new ProviderError(
      "fal rejected the request. Check your API key, credits and endpoint access.",
      true,
    );
  if (status === 422 || status === 400)
    return new ProviderError(
      "fal rejected the model inputs. Review the saved parameters and endpoint compatibility.",
      true,
    );
  if (status === 429)
    return new ProviderError(
      "fal is rate limiting requests. Try again shortly.",
      true,
    );
  return new ProviderError(
    `fal request failed${status ? ` (HTTP ${status})` : ""}. Its remote outcome may be unknown.`,
    false,
  );
}
export function parseFalResult(kind: JobKind, data: unknown): ProviderResult {
  const map = (a: z.infer<typeof artifact>) => ({
    url: a.url,
    contentType: a.content_type,
  });
  if (kind === "training") {
    const r = z
      .object({ diffusers_lora_file: artifact, config_file: artifact })
      .parse(data);
    return { lora: map(r.diffusers_lora_file), config: map(r.config_file) };
  }
  if (kind === "pose" || kind === "mask")
    return { images: [map(z.object({ image: artifact }).parse(data).image)] };
  const r = z
    .object({
      images: z.array(artifact),
      seed: z.number().int(),
      has_nsfw_concepts: z.array(z.boolean()).optional(),
      timings: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(data);
  return {
    images: r.images.map(map),
    seed: r.seed,
    blocked: r.has_nsfw_concepts?.some(Boolean),
    metadata: { timings: r.timings || {} },
  };
}
export class FalProvider implements AIProvider {
  buildInput = buildFluxInput;
  estimateTraining = trainingEstimate;
  estimateGeneration = generationEstimate;
  capabilities = {
    id: "fal" as const,
    name: "fal.ai",
    baseModel: "flux-1-dev" as const,
    trainingModel: FAL_ENDPOINTS.training,
    generationModel: FAL_ENDPOINTS.generation,
    poseModel: FAL_ENDPOINTS.pose,
    controls: [
      "identity",
      "pose",
      "reference",
      "transformation",
      "guidance",
      "steps",
      "seed",
      "resolution",
    ],
  };
  private client() {
    this.assertConfigured();
    return createFalClient({
      credentials: process.env.FAL_KEY,
      retry: { maxRetries: 0 },
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(120_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    });
  }
  assertConfigured() {
    if (!process.env.FAL_KEY)
      throw new AppError(
        "Add FAL_KEY to .env.local and restart the application.",
        503,
        "provider_not_configured",
      );
  }
  async upload(bytes: Buffer, name: string, mime: string) {
    try {
      return await this.client().storage.upload(
        new File([new Uint8Array(bytes)], name, { type: mime }),
      );
    } catch (e) {
      throw providerError(e);
    }
  }
  async submit(kind: JobKind, input: Record<string, unknown>) {
    const endpoint: string = FAL_ENDPOINTS[kind];
    try {
      const r = await this.client().queue.submit(endpoint, { input });
      return { requestId: r.request_id, endpoint };
    } catch (e) {
      throw providerError(e);
    }
  }
  async status(endpoint: string, requestId: string) {
    try {
      const r = await this.client().queue.status(endpoint, {
        requestId,
        logs: false,
      });
      return {
        state:
          r.status === "COMPLETED"
            ? ("completed" as const)
            : r.status === "IN_PROGRESS"
              ? ("running" as const)
              : ("queued" as const),
      };
    } catch (e) {
      throw providerError(e);
    }
  }
  async result(kind: JobKind, endpoint: string, requestId: string) {
    try {
      const r = await this.client().queue.result(endpoint, { requestId });
      return parseFalResult(kind, r.data);
    } catch (e) {
      if (e instanceof z.ZodError)
        throw new ProviderError(
          "fal returned an unexpected result schema. The request ID is saved for inspection.",
          true,
        );
      throw providerError(e);
    }
  }
  async cancel(endpoint: string, requestId: string) {
    try {
      await this.client().queue.cancel(endpoint, { requestId });
    } catch (e) {
      throw providerError(e);
    }
  }
  download = fetchArtifact;
}
