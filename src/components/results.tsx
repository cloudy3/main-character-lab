"use client";
import { useState } from "react";
import {
  Download,
  RotateCcw,
  SlidersHorizontal,
  Maximize2,
  Copy,
} from "lucide-react";
import type { GenerationView } from "@/domain/views";
import { assetUrl, date, money } from "./api";
import { JobStatus, Modal } from "./common";
export function Results({
  generation,
  onReuse,
  onRegenerate,
  onRefresh,
}: {
  generation: GenerationView;
  onReuse: (generation: GenerationView, seed?: number) => void;
  onRegenerate: (generation: GenerationView, seed?: number) => void;
  onRefresh: () => void;
}) {
  const [params, setParams] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const actuals = generation.jobs.map((j) => j.actualCost);
  const actual = actuals.every((c) => c != null)
    ? actuals.reduce<number>((a, b) => a + (b ?? 0), 0)
    : null;
  return (
    <div className="results">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CONTACT SHEET</p>
          <h2>{generation.snapshot.identityName}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="View generation parameters"
          onClick={() => setParams(true)}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>
      <div className="result-meta">
        <span>{date(generation.createdAt)}</span>
        <span>
          {generation.snapshot.controls.width} ×{" "}
          {generation.snapshot.controls.height} ·{" "}
          {actual == null
            ? `~${money(generation.estimate.amount)} estimated`
            : `${money(actual)} actual`}
        </span>
      </div>
      <div
        className={`result-grid ${generation.outputs.length === 1 ? "single" : ""}`}
      >
        {generation.outputs.map((output, index) => (
          <article className="result-card" key={output.id}>
            <div className="result-image">
              <img
                src={assetUrl(output.assetId)}
                alt={`Generated photograph of ${generation.snapshot.identityName}, frame ${index + 1}`}
              />
              <span className="frame-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <button
                className="image-expand"
                aria-label="Enlarge image"
                onClick={() => setFull(output.assetId)}
              >
                <Maximize2 size={17} />
              </button>
            </div>
            <div className="result-bottom">
              <span className="mono">SEED {output.seed}</span>
              <a
                className="icon-button"
                title="Download photograph"
                aria-label="Download photograph"
                href={`${assetUrl(output.assetId)}?download`}
              >
                <Download size={17} />
              </a>
            </div>
            <div className="result-actions">
              <button onClick={() => onRegenerate(generation)}>
                <RotateCcw size={13} /> Regenerate
              </button>
              <button onClick={() => onRegenerate(generation, output.seed)}>
                Same seed
              </button>
              <button onClick={() => onReuse(generation, output.seed)}>
                <Copy size={13} /> Use settings
              </button>
              <button onClick={() => setParams(true)}>Parameters</button>
            </div>
          </article>
        ))}
      </div>
      {generation.jobs.some((j) => j.status !== "completed") && (
        <div className="stack">
          {generation.jobs
            .filter((j) => j.status !== "completed")
            .map((j) => (
              <JobStatus key={j.id} job={j} onChange={onRefresh} />
            ))}
        </div>
      )}
      {params && (
        <Modal title="Generation parameters" onClose={() => setParams(false)}>
          <p className="help">
            Saved settings are immutable. Reusing a seed is best-effort: hosted
            model updates can change results.
          </p>
          <div className="parameter-ref">
            <img
              src={assetUrl(generation.snapshot.referenceAssetId)}
              alt="Original reference"
            />
            <div>
              <strong>{generation.snapshot.identityName}</strong>
              <p>
                {generation.provider} · {generation.snapshot.baseModel}
              </p>
              <small>{date(generation.createdAt)}</small>
            </div>
          </div>
          <pre>
            {JSON.stringify(
              {
                id: generation.id,
                provider: generation.provider,
                createdAt: new Date(generation.createdAt).toISOString(),
                estimate: generation.estimate,
                actualCost: actual,
                ...generation.snapshot,
                outputs: generation.outputs.map((o) => ({
                  seed: o.seed,
                  assetId: o.assetId,
                })),
                jobs: generation.jobs,
              },
              null,
              2,
            )}
          </pre>
        </Modal>
      )}
      {full && (
        <Modal title="Photograph" onClose={() => setFull(null)}>
          <img
            className="full-image"
            src={assetUrl(full)}
            alt="Generated photograph enlarged"
          />
          <a className="secondary" href={`${assetUrl(full)}?download`}>
            <Download size={15} /> Download original
          </a>
        </Modal>
      )}
    </div>
  );
}
