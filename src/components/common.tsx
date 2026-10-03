"use client";
import { useRef, useState } from "react";
import { AlertCircle, Check, Loader2, Upload, X } from "lucide-react";
import type { JobView } from "@/domain/views";
import { request } from "./api";
export function ErrorMessage({ message }: { message?: string }) {
  return message ? (
    <div className="error" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Dropzone({
  multiple = false,
  onFiles,
  busy = false,
  label = "Choose a reference photograph",
  detail = "JPEG, PNG or WebP · up to 20 MB each",
}: {
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  busy?: boolean;
  label?: string;
  detail?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={`dropzone ${drag ? "drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!busy)
          onFiles(Array.from(e.dataTransfer.files).slice(0, multiple ? 40 : 1));
      }}
    >
      <input
        ref={input}
        aria-label={label}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        disabled={busy}
        onChange={(e) => {
          onFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="dropzone-button"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <Loader2 className="spin" size={25} />
        ) : (
          <Upload size={25} strokeWidth={1.4} />
        )}
        <strong>{busy ? "Uploading…" : label}</strong>
        <span>
          Drop {multiple ? "photos" : "an image"} here, or browse files
        </span>
        <small>{detail}</small>
      </button>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <dialog
      className="modal"
      ref={(node) => {
        ref.current = node;
        if (node && !node.open) node.showModal();
      }}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function JobStatus({
  job,
  onChange,
}: {
  job: JobView;
  onChange?: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState("");
  async function act(action: string) {
    if (
      (action === "abandon" || action === "retry") &&
      !window.confirm(
        action === "abandon"
          ? "Have you checked the provider history? This abandons local tracking only. Any remote job can still be billed."
          : "Resume this job? Existing provider requests will be polled again. If nothing was submitted, this will submit a paid request.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await request(`jobs/${job.id}`, {
        method: "POST",
        body: JSON.stringify({ action, requestId }),
      });
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const working = !["completed", "failed", "uncertain", "cancelled"].includes(
    job.status,
  );
  return (
    <div className={`job-state ${job.status}`}>
      <div className="row">
        <span className="job-label">
          {working ? (
            <Loader2 size={14} className="spin" />
          ) : job.status === "completed" ? (
            <Check size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
          <strong>
            {job.kind === "mask"
              ? "Face mask"
              : job.kind[0].toUpperCase() + job.kind.slice(1)}
          </strong>
          <span>{job.status}</span>
        </span>
        {working && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void act("cancel")}
          >
            Cancel
          </button>
        )}
      </div>
      {job.message && <small>{job.message}</small>}
      {job.error && <p className="job-error">{job.error}</p>}
      {job.requestId && (
        <details>
          <summary>Provider request</summary>
          <code className="break">
            {job.endpoint}
            <br />
            {job.requestId}
          </code>
        </details>
      )}
      {job.status === "failed" && (
        <button
          className="secondary small"
          disabled={busy}
          onClick={() => void act("retry")}
        >
          Resume / retry
        </button>
      )}
      {job.status === "uncertain" && (
        <div className="stack">
          <label>
            Existing provider request ID
            <input
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder="Copy from fal request history"
            />
          </label>
          <div className="row">
            <button
              className="secondary small"
              disabled={busy || !requestId}
              onClick={() => void act("attach")}
            >
              Attach request
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void act("abandon")}
            >
              Abandon local tracking
            </button>
          </div>
        </div>
      )}
      <ErrorMessage message={error} />
    </div>
  );
}
export function Slider({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <label className="slider-label">
      <span>
        {label}
        <output>{value.toFixed(step < 1 ? 2 : 0)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}
