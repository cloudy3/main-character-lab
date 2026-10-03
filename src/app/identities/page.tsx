"use client";
import { useState } from "react";
import {
  Plus,
  Fingerprint,
  Trash2,
  ArrowUpRight,
  Download,
  Check,
  Images,
} from "lucide-react";
import Link from "next/link";
import type { IdentityView } from "@/domain/views";
import { assetUrl, date, money, request, useData } from "@/components/api";
import { Dropzone, ErrorMessage, JobStatus, Modal } from "@/components/common";
import { trainingEstimate } from "@/domain/controls";
export default function IdentitiesPage() {
  const {
    data,
    error: loadError,
    refresh,
  } = useData<IdentityView[]>("identities", 3000);
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [steps, setSteps] = useState(1000);
  const [trainConfirm, setTrainConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const identity = data?.find((i) => i.id === selected) || data?.[0];
  async function create() {
    setBusy(true);
    setError("");
    try {
      const item = await request<{ id: string }>("identities", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setSelected(item.id);
      setName("");
      setCreating(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: File[]) {
    if (!identity) return;
    setBusy(true);
    setError("");
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      setMessage(`Uploading ${index + 1} of ${files.length}`);
      try {
        const form = new FormData();
        form.set("file", file);
        await request(`identities/${identity.id}/photos`, {
          method: "POST",
          body: form,
        });
      } catch (e) {
        failures.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    setError(failures.join(" · "));
    setMessage("");
    setBusy(false);
    await refresh();
  }
  async function removePhoto(id: string) {
    if (!identity) return;
    setError("");
    try {
      await request(`identities/${identity.id}/photos/${id}`, {
        method: "DELETE",
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function train() {
    if (!identity) return;
    setBusy(true);
    setError("");
    try {
      await request(`identities/${identity.id}/train`, {
        method: "POST",
        body: JSON.stringify({ steps, confirmCost: true }),
      });
      setTrainConfirm(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeIdentity() {
    if (!identity) return;
    setBusy(true);
    setError("");
    try {
      await request(`identities/${identity.id}`, { method: "DELETE" });
      setDeleteConfirm(false);
      setSelected("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const activeTraining = identity?.trainings.some(
    (t) =>
      t.job &&
      !["completed", "failed", "cancelled", "uncertain"].includes(t.job.status),
  );
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">01 / YOUR FOUNDATION</p>
          <h1>Every frame starts with you.</h1>
          <p className="subtitle">
            Train your identity once. Bring it to any photographic setup.
          </p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={17} /> New identity
        </button>
      </div>
      <ErrorMessage message={error || loadError} />
      {!data ? (
        <div className="empty-panel">Loading your local library…</div>
      ) : data.length === 0 ? (
        <div className="empty-panel identity-empty">
          <Fingerprint size={52} strokeWidth={1} />
          <h2>A familiar face, in a new light.</h2>
          <p>
            Add 15–30 varied photos of yourself to create your first reusable
            identity.
          </p>
          <button className="primary" onClick={() => setCreating(true)}>
            Create an identity <ArrowUpRight size={16} />
          </button>
          <div className="tip-row">
            <span>Different angles</span>
            <span>Natural expressions</span>
            <span>Varied lighting</span>
          </div>
        </div>
      ) : (
        <div className="identity-layout">
          <aside className="identity-list">
            {data.map((i) => (
              <button
                key={i.id}
                className={`identity-card ${identity?.id === i.id ? "selected" : ""}`}
                onClick={() => {
                  setSelected(i.id);
                  setError("");
                }}
              >
                {i.photos[0] ? (
                  <img src={assetUrl(i.photos[0].assetId)} alt="" />
                ) : (
                  <span className="avatar">
                    <Fingerprint size={24} />
                  </span>
                )}
                <span>
                  <strong>{i.name}</strong>
                  <small>
                    {i.photos.length} photos ·{" "}
                    {
                      i.trainings.filter((t) => t.job?.status === "completed")
                        .length
                    }{" "}
                    trained versions
                  </small>
                </span>
              </button>
            ))}
          </aside>
          {identity && (
            <div className="stack section-stack">
              <div className="panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">IDENTITY DATASET</p>
                    <h2>{identity.name}</h2>
                  </div>
                  <span className="pill">
                    {identity.photos.length} / 40 photos
                  </span>
                </div>
                <p className="help">
                  Aim for 15–30 clear photos of only you: close-ups, half-body
                  and full-body shots, different clothes, angles and lighting.
                  Remove group photos, duplicates and heavily filtered images.
                </p>
                <Dropzone
                  multiple
                  onFiles={(files) => void upload(files)}
                  busy={busy}
                  label="Add your identity photos"
                />
                {message && (
                  <p className="help" role="status">
                    {message}
                  </p>
                )}
                <div className="photo-grid">
                  {identity.photos.map((p) => (
                    <div className="photo-tile" key={p.id}>
                      <img
                        src={assetUrl(p.assetId)}
                        alt="Identity training photo"
                      />
                      <button
                        aria-label="Remove photo"
                        disabled={busy}
                        onClick={() => void removePhoto(p.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                      <small>
                        {p.asset.width} × {p.asset.height}
                      </small>
                    </div>
                  ))}
                </div>
                <div className="dataset-status">
                  <span>
                    {identity.photos.length >= 10 ? (
                      <Check size={15} />
                    ) : (
                      <Images size={15} />
                    )}{" "}
                    {identity.photos.length < 10
                      ? `${10 - identity.photos.length} more photos needed to train`
                      : identity.photos.length < 15
                        ? "Ready to train. A few more varied photos may improve likeness."
                        : "Dataset ready for training"}
                  </span>
                  <small>Exact duplicates are rejected.</small>
                </div>
              </div>
              <div className="panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">TRAIN & KEEP</p>
                    <h2>Create an identity LoRA</h2>
                  </div>
                  <span className="pill">FLUX.1 dev</span>
                </div>
                <p className="help">
                  A small reusable model of your appearance. Your photos are
                  sent to fal for training; the resulting weights are saved on
                  this computer.
                </p>
                <details className="advanced">
                  <summary>Training settings</summary>
                  <div className="advanced-body">
                    <label>
                      Training steps
                      <select
                        value={steps}
                        onChange={(e) => setSteps(Number(e.target.value))}
                      >
                        {[500, 1000, 1500, 2000, 2500, 3000].map((n) => (
                          <option value={n} key={n}>
                            {n}
                            {n === 1000 ? " · recommended" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="help">
                      More steps can overfit; start with 1,000. Auto-captioning
                      and subject masks are enabled.
                    </p>
                    <label>
                      Unique trigger token
                      <code className="token">{identity.trigger}</code>
                    </label>
                  </div>
                </details>
                <div className="training-action">
                  <div>
                    <strong>~{money(trainingEstimate(steps).amount)}</strong>
                    <small>Estimated one-time cost</small>
                  </div>
                  <button
                    className="primary"
                    disabled={
                      busy || identity.photos.length < 10 || activeTraining
                    }
                    onClick={() => setTrainConfirm(true)}
                  >
                    {activeTraining
                      ? "Training in progress…"
                      : identity.trainings.length
                        ? "Train a new version"
                        : "Train identity"}
                    <ArrowUpRight size={17} />
                  </button>
                </div>
              </div>
              {identity.trainings.length > 0 && (
                <div className="panel">
                  <h2>Trained versions</h2>
                  <p className="help">
                    Each version keeps its own dataset snapshot and settings.
                  </p>
                  {identity.trainings.map((t, index) => (
                    <div className="training-run" key={t.id}>
                      <div className="row">
                        <strong>
                          Version {identity.trainings.length - index}
                        </strong>
                        <small>{date(t.createdAt)}</small>
                      </div>
                      <p className="help">
                        {t.snapshot.dataset.length} photos · {t.snapshot.steps}{" "}
                        steps · {t.provider} ·{" "}
                        {t.actualCost != null
                          ? `${money(t.actualCost)} actual`
                          : `~${money(t.estimate.amount)} estimated`}
                      </p>
                      {t.job && (
                        <JobStatus
                          job={t.job}
                          onChange={() => void refresh()}
                        />
                      )}
                      <div className="row wrap">
                        {t.loraAssetId && t.job?.status === "completed" && (
                          <>
                            <Link
                              className="secondary small"
                              href={`/?training=${t.id}`}
                            >
                              Use in studio <ArrowUpRight size={14} />
                            </Link>
                            <a
                              className="text-button"
                              href={`${assetUrl(t.loraAssetId)}?download`}
                            >
                              <Download size={14} /> Weights
                            </a>
                          </>
                        )}
                        {t.configAssetId && (
                          <a
                            className="text-button"
                            href={`${assetUrl(t.configAssetId)}?download`}
                          >
                            Configuration
                          </a>
                        )}
                      </div>
                      <details>
                        <summary>Training metadata</summary>
                        <pre>{JSON.stringify(t.snapshot, null, 2)}</pre>
                      </details>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="danger-link"
                onClick={() => setDeleteConfirm(true)}
              >
                <Trash2 size={14} /> Delete identity and local training files
              </button>
            </div>
          )}
        </div>
      )}
      {creating && (
        <Modal title="Create an identity" onClose={() => setCreating(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="stack"
          >
            <label>
              Identity name
              <input
                autoFocus
                maxLength={80}
                value={name}
                placeholder="e.g. My editorial identity"
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <p className="help">
              Give your photo collection a name. Training starts only when you
              explicitly request it.
            </p>
            <ErrorMessage message={error} />
            <button className="primary" disabled={busy || !name.trim()}>
              Create identity
            </button>
          </form>
        </Modal>
      )}
      {trainConfirm && identity && (
        <Modal
          title="Start identity training"
          onClose={() => setTrainConfirm(false)}
        >
          <div className="stack">
            <p>
              Train <strong>{identity.name}</strong> with{" "}
              {identity.photos.length} photos and {steps} steps?
            </p>
            <div className="cost-card">
              <span>Estimated charge</span>
              <strong>{money(trainingEstimate(steps).amount)}</strong>
            </div>
            <p className="help">
              Your photos will be uploaded to fal. This is a paid, explicit
              training run. An existing trained version will remain available.
            </p>
            <ErrorMessage message={error} />
            <button
              className="primary"
              disabled={busy}
              onClick={() => void train()}
            >
              {busy ? "Starting…" : "Start paid training"}
            </button>
          </div>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal
          title="Delete this identity?"
          onClose={() => setDeleteConfirm(false)}
        >
          <div className="stack">
            <p>
              Local training photos, LoRA weights and configuration files will
              be removed. This cannot be undone without a backup.
            </p>
            <p className="help">
              Generated photographs and historical parameters remain. This does
              not delete copies held by the external provider.
            </p>
            <ErrorMessage message={error} />
            <button
              className="danger"
              disabled={busy}
              onClick={() => void removeIdentity()}
            >
              Delete local identity files
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
