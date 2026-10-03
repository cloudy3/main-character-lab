import { describe, expect, it } from "vitest";
import { buildFluxInput } from "@/server/providers/flux-input";
import {
  DEFAULT_CONTROLS,
  controlsSchema,
  generationEstimate,
  resolveControls,
  seedsForBatch,
  trainingEstimate,
} from "@/domain/controls";
describe("photography controls", () => {
  it("maps distinct identity, pose, reference and transformation controls to the provider", () => {
    const controls = resolveControls(
      {
        ...DEFAULT_CONTROLS,
        identity: 1.2,
        pose: 0.7,
        reference: 0.4,
        transformation: 0.8,
      },
      768,
      1024,
    );
    const request = {
      kind: "generation" as const,
      prompt: "identity token",
      imageUrl: "protected-image",
      poseUrl: "body-pose",
      loraUrl: "identity-weights",
      controls,
      seed: 0,
    };
    const input = buildFluxInput(request);
    expect(input).toMatchObject({
      image_url: "protected-image",
      reference_image_url: "protected-image",
      reference_strength: 0.4,
      strength: 0.8,
      seed: 0,
      loras: [{ path: "identity-weights", scale: 1.2 }],
      controlnet_unions: [
        {
          controls: [
            {
              control_image_url: "body-pose",
              control_mode: "pose",
              conditioning_scale: 0.7,
            },
          ],
        },
      ],
    });
    expect(
      buildFluxInput({ ...request, controls: { ...controls, pose: 0 } })
        .controlnet_unions,
    ).toEqual([]);
  });
  it("keeps identity independent while fidelity changes real conditioning parameters", () => {
    const low = resolveControls(
      { ...DEFAULT_CONTROLS, fidelity: 0 },
      768,
      1024,
    );
    const high = resolveControls(
      { ...DEFAULT_CONTROLS, fidelity: 100 },
      768,
      1024,
    );
    expect(high.identity).toBe(low.identity);
    expect(high.pose).toBeGreaterThan(low.pose);
    expect(high.reference).toBeGreaterThan(low.reference);
    expect(high.transformation).toBeLessThan(low.transformation);
    expect(low.width).toBe(768);
    expect(low.height).toBe(1024);
  });
  it("preserves explicit overrides including zero", () => {
    const c = resolveControls(
      {
        ...DEFAULT_CONTROLS,
        pose: 0,
        reference: 0.2,
        transformation: 0.9,
        fidelity: 100,
      },
      1000,
      1000,
    );
    expect(c.pose).toBe(0);
    expect(c.reference).toBe(0.2);
    expect(c.transformation).toBe(0.9);
  });
  it("validates model bounds and resolves aspect ratios to 32-pixel multiples", () => {
    expect(() => controlsSchema.parse({ steps: 1000 })).toThrow();
    expect(() => controlsSchema.parse({ mysteryStrength: 1 })).toThrow();
    const c = resolveControls(
      { ...DEFAULT_CONTROLS, aspectRatio: "16:9", resolution: 1536 },
      800,
      1200,
    );
    expect(c.width).toBe(1536);
    expect(c.height % 32).toBe(0);
    expect(() => resolveControls(DEFAULT_CONTROLS, 100, 2000)).toThrow();
  });
  it("resolves a distinct reproducible seed per output without treating it as strength", () => {
    expect(seedsForBatch(0, 2)).toEqual([0, 1]);
    expect(seedsForBatch(2147483647, 3)).toEqual([2147483647, 0, 1]);
    expect(() => seedsForBatch(-1, 1)).toThrow();
    expect(() => seedsForBatch(1.5, 1)).toThrow();
    expect(() => seedsForBatch(1, 5)).toThrow();
  });
  it("shows estimates with conservative megapixel rounding, never invented actual costs", () => {
    expect(generationEstimate(768, 1024, 4).amount).toBe(0.3);
    expect(generationEstimate(1024, 1024, 1).amount).toBe(0.15);
    expect(trainingEstimate(1500).amount).toBe(3);
    expect(trainingEstimate(1000).kind).toBe("estimate");
  });
});
