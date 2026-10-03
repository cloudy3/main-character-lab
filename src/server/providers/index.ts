import "server-only";
import type { ProviderId } from "@/domain/types";
import { AppError } from "../errors";
import { FalProvider } from "./fal";
import { MockProvider } from "./mock";
export function configuredProvider(): ProviderId {
  return process.env.AI_PROVIDER === "mock" ? "mock" : "fal";
}
export function provider(id: ProviderId = configuredProvider()) {
  if (id === "mock" && configuredProvider() !== "mock")
    throw new AppError(
      "Offline test artifacts cannot be used with a live provider.",
      409,
    );
  return id === "mock" ? new MockProvider() : new FalProvider();
}
