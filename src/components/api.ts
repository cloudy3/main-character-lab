"use client";
import { useCallback, useEffect, useState } from "react";
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method || "GET";
  const headers = new Headers(options.headers);
  if (typeof options.body === "string")
    headers.set("Content-Type", "application/json");
  // Keep the same key after transport failures. A retry must not bill a second time.
  const fingerprint = `${method}:${path}:${typeof options.body === "string" ? options.body : "upload"}`;
  const storageKey = `mcl-request:${fingerprint}`;
  if (method === "POST" && !(options.body instanceof FormData)) {
    let key = sessionStorage.getItem(storageKey);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
    }
    headers.set("Idempotency-Key", key);
  }
  const response = await fetch(`/api/${path}`, { ...options, headers });
  const data = await response.json();
  if (response.ok || response.status < 500)
    sessionStorage.removeItem(storageKey);
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data as T;
}
export function useData<T>(path: string | null, interval = 0) {
  const [state, setState] = useState<{ path: string | null; data: T | null }>({
    path: null,
    data: null,
  });
  const setData = useCallback(
    (data: T | null) => setState({ path, data }),
    [path],
  );
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      const value = await request<T>(path);
      setData(value);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load data.");
    }
  }, [path, setData]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (!path) return;
      try {
        const value = await request<T>(path);
        if (live) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (live)
          setError(e instanceof Error ? e.message : "Unable to load data.");
      }
    };
    void load();
    const timer = interval
      ? setInterval(() => void load(), interval)
      : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path, interval, setData]);
  return {
    data: state.path === path ? state.data : null,
    error,
    refresh,
    setData,
  };
}
export const assetUrl = (id: string) => `/api/assets/${id}`;
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(value);
export const date = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
