"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import type { GenerationView, IdentityView } from "@/domain/views";
import { assetUrl, date, money, useData } from "@/components/api";
import { ErrorMessage, Modal } from "@/components/common";
import { Results } from "@/components/results";
import { useRouter } from "next/navigation";
export default function HistoryPage() {
  const [identity, setIdentity] = useState("");
  const [before, setBefore] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, refresh } = useData<GenerationView[]>(
    `history?identity=${identity}&before=${before}`,
    4000,
  );
  const { data: identities } = useData<IdentityView[]>("identities");
  const router = useRouter();
  const current = data?.find((g) => g.id === selected);
  function reuse(g: GenerationView, seed?: number) {
    router.push(`/?reuse=${g.id}${seed !== undefined ? `&seed=${seed}` : ""}`);
  }
  function regenerate(g: GenerationView, seed?: number) {
    router.push(
      `/?regenerate=${g.id}${seed !== undefined ? `&seed=${seed}` : ""}`,
    );
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE LOCAL ARCHIVE</p>
          <h1>
            Your work, <span className="serif">frame by frame.</span>
          </h1>
          <p className="subtitle">
            Every photograph, reference and setting. Ready to revisit.
          </p>
        </div>
        <Link className="secondary" href="/">
          Back to studio <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="archive-filters">
        <label>
          Identity
          <select
            value={identity}
            onChange={(e) => {
              setIdentity(e.target.value);
              setBefore("");
            }}
          >
            <option value="">All identities, including deleted</option>
            {identities?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Before date
          <input
            type="date"
            value={
              before ? new Date(Number(before)).toISOString().slice(0, 10) : ""
            }
            onChange={(e) =>
              setBefore(
                e.target.value
                  ? String(new Date(`${e.target.value}T23:59:59`).getTime())
                  : "",
              )
            }
          />
        </label>
        {before && (
          <button className="text-button" onClick={() => setBefore("")}>
            Show latest
          </button>
        )}
      </div>
      <ErrorMessage message={error} />
      {!data ? (
        <div className="empty-panel">Loading archive…</div>
      ) : !data.length ? (
        <div className="empty-panel">
          <Clock3 size={40} strokeWidth={1} />
          <h2>Your next photograph belongs here.</h2>
          <p>Completed and in-progress generations are saved automatically.</p>
          <Link className="primary" href="/">
            Open studio <ArrowUpRight size={16} />
          </Link>
        </div>
      ) : (
        <>
          <div className="archive-grid">
            {data.map((g) => (
              <button
                key={g.id}
                className="archive-card"
                onClick={() => setSelected(g.id)}
              >
                <div className="archive-image">
                  {g.outputs[0] ? (
                    <img
                      src={assetUrl(g.outputs[0].assetId)}
                      alt={`Generated photograph of ${g.snapshot.identityName}`}
                    />
                  ) : (
                    <div className="archive-pending">
                      <Clock3 size={28} />
                      <span>
                        {g.jobs.find((j) => j.status !== "completed")?.status ||
                          "Processing"}
                      </span>
                    </div>
                  )}
                  <img
                    className="reference-inset"
                    src={assetUrl(g.snapshot.referenceAssetId)}
                    alt="Reference thumbnail"
                  />
                  <span className="pill">
                    {g.outputs.length} / {g.snapshot.seeds.length} frames
                  </span>
                </div>
                <div className="archive-caption">
                  <strong>{g.snapshot.identityName}</strong>
                  <small>{date(g.createdAt)}</small>
                  <span>
                    {g.snapshot.controls.width} × {g.snapshot.controls.height}{" "}
                    <span>~{money(g.estimate.amount)}</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
          {data.length === 40 && (
            <button
              className="secondary"
              onClick={() => setBefore(String(data.at(-1)!.createdAt))}
            >
              Older generations
            </button>
          )}
        </>
      )}
      {current && (
        <Modal title="Saved generation" onClose={() => setSelected(null)}>
          <Results
            generation={current}
            onReuse={reuse}
            onRegenerate={regenerate}
            onRefresh={() => void refresh()}
          />
        </Modal>
      )}
    </section>
  );
}
