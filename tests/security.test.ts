import { beforeAll, describe, expect, it } from "vitest";
let guard: typeof import("@/server/http").guard;
let parseFalResult: typeof import("@/server/providers/fal").parseFalResult;
let validateRemoteUrl: typeof import("@/server/storage").validateRemoteUrl;
let assetPath: typeof import("@/server/storage").assetPath;
beforeAll(async () => {
  ({ guard } = await import("@/server/http"));
  ({ parseFalResult } = await import("@/server/providers/fal"));
  ({ validateRemoteUrl, assetPath } = await import("@/server/storage"));
});
describe("local and provider boundaries", () => {
  it("blocks cross-origin mutations and untrusted hosts", () => {
    expect(() =>
      guard(
        new Request("http://127.0.0.1:3000/api/identities", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow("origin");
    expect(() =>
      guard(new Request("http://evil.example/api/assets/id")),
    ).toThrow("host");
    expect(() =>
      guard(
        new Request("http://localhost:3000/api/identities", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
  });
  it("confines local paths and provider downloads", () => {
    expect(() => assetPath("../../.env.local")).toThrow();
    for (const url of [
      "http://fal.media/a",
      "https://fal.media.evil.example/a",
      "http://127.0.0.1/a",
      "https://fal.media:8443/a",
      "https://user:pass@fal.media/a",
    ])
      expect(() => validateRemoteUrl(url)).toThrow();
    expect(
      validateRemoteUrl("https://v3b.fal.media/files/example.png").hostname,
    ).toBe("v3b.fal.media");
  });
  it("validates real provider schemas and never fabricates cost", () => {
    const t = parseFalResult("training", {
      diffusers_lora_file: { url: "https://fal.media/lora.safetensors" },
      config_file: { url: "https://fal.media/config.json" },
    });
    expect(t.lora).toBeTruthy();
    expect(t.actualCost).toBeUndefined();
    const g = parseFalResult("generation", {
      images: [{ url: "https://fal.media/image.png" }],
      seed: 42,
      has_nsfw_concepts: [true],
    });
    expect(g.blocked).toBe(true);
    expect(g.seed).toBe(42);
    expect(() => parseFalResult("generation", { image: "nope" })).toThrow();
  });
});
