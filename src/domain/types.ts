export type ProviderId = "fal" | "mock";
export type JobKind = "training" | "pose" | "mask" | "generation";
export type JobStatus =
  | "pending"
  | "preparing"
  | "submitting"
  | "queued"
  | "running"
  | "saving"
  | "completed"
  | "failed"
  | "uncertain"
  | "cancelled";
export const TERMINAL: JobStatus[] = [
  "completed",
  "failed",
  "uncertain",
  "cancelled",
];
export type AspectRatio =
  | "reference"
  | "1:1"
  | "3:4"
  | "4:3"
  | "2:3"
  | "3:2"
  | "16:9"
  | "9:16";
export interface Controls {
  fidelity: number;
  identity: number;
  pose?: number;
  reference?: number;
  transformation?: number;
  guidance: number;
  steps: number;
  aspectRatio: AspectRatio;
  resolution: 768 | 1024 | 1536;
}
export interface EffectiveControls extends Controls {
  pose: number;
  reference: number;
  transformation: number;
  width: number;
  height: number;
  presetVersion: string;
}
export interface CostEstimate {
  amount: number;
  currency: "USD";
  kind: "estimate";
  asOf: string;
  note: string;
}
export interface TrainingSnapshot {
  identityName: string;
  trigger: string;
  steps: number;
  baseModel: "flux-1-dev";
  dataset: { assetId: string; sha256: string }[];
  trainer: string;
  captioning: "provider-auto";
  createMasks: true;
}
export interface GenerationSnapshot {
  identityName: string;
  trigger: string;
  trainingId: string;
  loraHash: string;
  referenceId: string;
  referenceAssetId: string;
  poseAssetId: string;
  maskAssetId: string;
  sanitizedAssetId: string;
  prompt: string;
  effectivePrompt: string;
  controls: EffectiveControls;
  seeds: number[];
  model: string;
  baseModel: "flux-1-dev";
}
export type JobPayload =
  | { kind: "training"; trainingId: string }
  | { kind: "pose"; referenceId: string; assetId: string }
  | { kind: "mask"; referenceId: string; assetId: string }
  | { kind: "generation"; generationId: string; index: number; seed: number };
export interface ProviderArtifact {
  url: string;
  contentType?: string;
}
export interface ProviderResult {
  images?: ProviderArtifact[];
  lora?: ProviderArtifact;
  config?: ProviderArtifact;
  seed?: number;
  actualCost?: number;
  blocked?: boolean;
  metadata?: Record<string, unknown>;
}
export interface ProviderStatus {
  state: "queued" | "running" | "completed";
  message?: string;
}
export interface ProviderCapabilities {
  id: ProviderId;
  name: string;
  baseModel: "flux-1-dev";
  trainingModel: string;
  generationModel: string;
  poseModel: string;
  controls: readonly string[];
}
