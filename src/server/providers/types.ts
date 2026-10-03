import type {
  JobKind,
  ProviderCapabilities,
  ProviderResult,
  ProviderStatus,
  CostEstimate,
  EffectiveControls,
} from "@/domain/types";
export type ModelRequest =
  | { kind: "training"; archiveUrl: string; trigger: string; steps: number }
  | { kind: "pose"; imageUrl: string }
  | { kind: "mask"; imageUrl: string }
  | {
      kind: "generation";
      prompt: string;
      imageUrl: string;
      poseUrl: string;
      loraUrl: string;
      seed: number;
      controls: EffectiveControls;
    };
export interface AIProvider {
  capabilities: ProviderCapabilities;
  assertConfigured(): void;
  estimateTraining(steps: number): CostEstimate;
  estimateGeneration(
    width: number,
    height: number,
    count: number,
  ): CostEstimate;
  buildInput(request: ModelRequest): Record<string, unknown>;
  upload(bytes: Buffer, name: string, mime: string): Promise<string>;
  submit(
    kind: JobKind,
    input: Record<string, unknown>,
  ): Promise<{ requestId: string; endpoint: string }>;
  status(endpoint: string, requestId: string): Promise<ProviderStatus>;
  result(
    kind: JobKind,
    endpoint: string,
    requestId: string,
  ): Promise<ProviderResult>;
  cancel(endpoint: string, requestId: string): Promise<void>;
  download(url: string, maxBytes: number): Promise<Buffer>;
}
