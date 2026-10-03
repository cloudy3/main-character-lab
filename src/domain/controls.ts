import { z } from "zod";
import type { Controls, CostEstimate, EffectiveControls } from "./types";
export const controlsSchema = z
  .object({
    fidelity: z.number().min(0).max(100).default(60),
    identity: z.number().min(0.4).max(1.6).default(1),
    pose: z.number().min(0).max(1.2).optional(),
    reference: z.number().min(0).max(1).optional(),
    transformation: z.number().min(0.5).max(1).optional(),
    guidance: z.number().min(1).max(8).default(3.5),
    steps: z.number().int().min(15).max(50).default(28),
    aspectRatio: z
      .enum(["reference", "1:1", "3:4", "4:3", "2:3", "3:2", "16:9", "9:16"])
      .default("reference"),
    resolution: z
      .union([z.literal(768), z.literal(1024), z.literal(1536)])
      .default(1024),
  })
  .strict();
export const DEFAULT_CONTROLS: Controls = controlsSchema.parse({});
export const seedSchema = z.number().int().min(0).max(2147483647);
export function resolveControls(
  input: Controls,
  width: number,
  height: number,
): EffectiveControls {
  const c = controlsSchema.parse(input);
  const f = c.fidelity / 100;
  const ratio =
    c.aspectRatio === "reference"
      ? width / height
      : (() => {
          const [w, h] = c.aspectRatio.split(":").map(Number);
          return w / h;
        })();
  if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4)
    throw new Error("Use a reference aspect ratio between 1:4 and 4:1.");
  const long = c.resolution;
  return {
    ...c,
    pose: c.pose ?? +(0.4 + 0.5 * f).toFixed(3),
    reference: c.reference ?? +(0.2 + 0.45 * f).toFixed(3),
    transformation: c.transformation ?? +(0.95 - 0.2 * f).toFixed(3),
    width: Math.max(
      256,
      Math.round((ratio >= 1 ? long : long * ratio) / 32) * 32,
    ),
    height: Math.max(
      256,
      Math.round((ratio >= 1 ? long / ratio : long) / 32) * 32,
    ),
    presetVersion: "reference-v1",
  };
}
export function seedsForBatch(base: number, count: number) {
  seedSchema.parse(base);
  z.number().int().min(1).max(4).parse(count);
  return Array.from({ length: count }, (_, i) => (base + i) % 2147483648);
}
export function trainingEstimate(steps: number): CostEstimate {
  return {
    amount: (2 * steps) / 1000,
    currency: "USD",
    kind: "estimate",
    asOf: "2026-10-03",
    note: "fal published rate: $2 / 1,000 steps. Check current account pricing before training.",
  };
}
export function generationEstimate(
  width: number,
  height: number,
  count: number,
): CostEstimate {
  return {
    amount: +(Math.ceil((width * height) / 1_000_000) * 0.075 * count).toFixed(
      3,
    ),
    currency: "USD",
    kind: "estimate",
    asOf: "2026-10-03",
    note: "Conservative estimate at $0.075 per rounded-up decimal megapixel. Reference preparation is billed separately by compute time.",
  };
}
export function buildPrompt(trigger: string, instructions: string) {
  return `Professional editorial photograph of ${trigger}, one person. Natural facial anatomy and realistic skin texture, coherent lighting across the entire subject and scene. Recreate the clothing, body pose, framing, camera perspective, background, lighting direction and photographic treatment from the reference. The person is ${trigger}. ${instructions.trim()}`.trim();
}
