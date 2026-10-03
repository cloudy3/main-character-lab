import "server-only";
import { trainingEstimate, generationEstimate } from "@/domain/controls";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { AIProvider } from "./types";
import type { JobKind, ProviderResult } from "@/domain/types";
import { FAL_ENDPOINTS } from "./fal";
import { buildFluxInput } from "./flux-input";
import { readAsset, storeAsset } from "../storage";
// Durable deterministic fixtures, never presented as AI-generated photographs.
export class MockProvider implements AIProvider {
  buildInput = buildFluxInput;
  estimateTraining(steps: number) {
    return {
      ...trainingEstimate(steps),
      amount: 0,
      note: "Offline fixture; no API charge.",
    };
  }
  estimateGeneration(width: number, height: number, count: number) {
    return {
      ...generationEstimate(width, height, count),
      amount: 0,
      note: "Offline fixture; no API charge.",
    };
  }
  capabilities = {
    id: "mock" as const,
    name: "Offline test adapter",
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
  assertConfigured() {}
  async upload(bytes: Buffer, name: string, mime: string) {
    const a = await storeAsset(bytes, mime, "mock-upload");
    return `mock://${a.id}/${name}`;
  }
  async submit(kind: JobKind, input: Record<string, unknown>) {
    const asset = await storeAsset(
      Buffer.from(JSON.stringify({ kind, input })),
      "application/json",
      "mock-request",
    );
    return { requestId: asset.id, endpoint: FAL_ENDPOINTS[kind] };
  }
  async status() {
    return { state: "completed" as const };
  }
  async result(
    kind: JobKind,
    endpoint: string,
    id: string,
  ): Promise<ProviderResult> {
    const { input } = JSON.parse((await readAsset(id)).toString()) as {
      input: Record<string, unknown>;
    };
    if (kind === "training")
      return {
        lora: { url: "mock://weights" },
        config: { url: "mock://config" },
        actualCost: 0,
      };
    return {
      images: [
        {
          url: `mock://render/${kind}/${Number(input.seed ?? 1)}/${Number((input.image_size as { width: number } | undefined)?.width || 768)}/${Number((input.image_size as { height: number } | undefined)?.height || 1024)}`,
        },
      ],
      seed: Number(input.seed ?? 1),
      actualCost: 0,
      metadata: { mock: true },
    };
  }
  async cancel() {}
  async download(url: string) {
    if (url === "mock://weights")
      return Buffer.from("MOCK WEIGHTS — not a trained model");
    if (url === "mock://config")
      return Buffer.from(JSON.stringify({ mock: true, id: randomUUID() }));
    const [, , , kind, seed, w, h] = url.split("/");
    const width = Number(w) || 768;
    const height = Number(h) || 1024;
    const body =
      kind === "mask"
        ? `<rect width="100%" height="100%" fill="black"/><ellipse cx="${width / 2}" cy="${height * 0.28}" rx="${width * 0.13}" ry="${height * 0.14}" fill="white"/>`
        : kind === "pose"
          ? `<rect width="100%" height="100%" fill="black"/><path d="M ${width / 2} ${height * 0.25} L ${width / 2} ${height * 0.65} M ${width * 0.25} ${height * 0.5} L ${width / 2} ${height * 0.4} L ${width * 0.75} ${height * 0.5} M ${width * 0.3} ${height * 0.9} L ${width / 2} ${height * 0.65} L ${width * 0.7} ${height * 0.9}" stroke="#58d6aa" stroke-width="10"/>`
          : `<defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#37423c"/><stop offset="1" stop-color="#14191a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width / 2}" cy="${height * 0.35}" r="${width * 0.15}" fill="#87918a"/><path d="M ${width * 0.2} ${height} Q ${width * 0.2} ${height * 0.52} ${width / 2} ${height * 0.52} Q ${width * 0.8} ${height * 0.52} ${width * 0.8} ${height}" fill="#5c6861"/><text x="30" y="50" fill="white" font-size="24">OFFLINE TEST · SEED ${Number(seed)}</text><text x="30" y="${height - 35}" fill="white" font-size="18">This is a fixture, not an AI photograph.</text>`;
    return sharp(
      Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
      ),
    )
      .png()
      .toBuffer();
  }
}
