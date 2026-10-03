export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "invalid_request",
  ) {
    super(message);
  }
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public definitive = false,
  ) {
    super(message);
  }
}
export function safeError(error: unknown): string {
  if (error instanceof AppError || error instanceof ProviderError)
    return error.message;
  return "The operation could not be completed. Check the local server log and try again.";
}
export function logError(event: string, error: unknown, id?: string) {
  // Do not log SDK errors: they may contain credentials, signed URLs or image data.
  console.error(
    JSON.stringify({
      level: "error",
      event,
      id,
      type: error instanceof Error ? error.name : "UnknownError",
      at: new Date().toISOString(),
    }),
  );
}
