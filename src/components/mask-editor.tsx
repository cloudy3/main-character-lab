"use client";
import { useEffect, useRef, useState } from "react";
import { Eraser, Paintbrush, RotateCcw, ShieldCheck } from "lucide-react";
import type { ReferenceView } from "@/domain/views";
import { assetUrl, request } from "./api";
import { ErrorMessage } from "./common";
export function MaskEditor({
  reference,
  onSaved,
}: {
  reference: ReferenceView;
  onSaved: () => void;
}) {
  const visible = useRef<HTMLCanvasElement>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const source = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [size, setSize] = useState(45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  function render() {
    const canvas = visible.current;
    const m = mask.current;
    if (!canvas || !m || !source.current) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source.current, 0, 0, canvas.width, canvas.height);
    const overlay = document.createElement("canvas");
    overlay.width = m.width;
    overlay.height = m.height;
    const o = overlay.getContext("2d")!;
    const pixels = m.getContext("2d")!.getImageData(0, 0, m.width, m.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const alpha = pixels.data[i] > 127 ? 155 : 0;
      pixels.data[i] = 210;
      pixels.data[i + 1] = 236;
      pixels.data[i + 2] = 156;
      pixels.data[i + 3] = alpha;
    }
    o.putImageData(pixels, 0, 0);
    ctx.drawImage(overlay, 0, 0);
  }
  useEffect(() => {
    let live = true;
    const load = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
    void Promise.all([
      load(assetUrl(reference.assetId)),
      reference.maskAssetId
        ? load(assetUrl(reference.maskAssetId))
        : Promise.resolve(null),
    ])
      .then(([image, initialMask]) => {
        if (!live || !visible.current) return;
        const ratio = Math.min(1, 960 / image.width);
        const w = Math.round(image.width * ratio);
        const h = Math.round(image.height * ratio);
        const m = document.createElement("canvas");
        m.width = w;
        m.height = h;
        const ctx = m.getContext("2d")!;
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, w, h);
        if (initialMask) ctx.drawImage(initialMask, 0, 0, w, h);
        mask.current = m;
        source.current = image;
        visible.current.width = w;
        visible.current.height = h;
        render();
        setLoaded(true);
      })
      .catch(() => {
        if (live) setError("Unable to load mask preview.");
      });
    return () => {
      live = false;
    };
  }, [reference.assetId, reference.maskAssetId]);
  function paint(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !mask.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x =
      ((event.clientX - bounds.left) / bounds.width) * mask.current.width;
    const y =
      ((event.clientY - bounds.top) / bounds.height) * mask.current.height;
    const ctx = mask.current.getContext("2d")!;
    ctx.strokeStyle = mode === "paint" ? "white" : "black";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    if (last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    last.current = { x, y };
    render();
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        mask.current!.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Cannot export mask."))),
          "image/png",
        ),
      );
      const form = new FormData();
      form.set("file", blob, "mask.png");
      await request(`references/${reference.id}/mask`, {
        method: "POST",
        body: form,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mask-editor">
      <div className="row wrap">
        <div className="segmented">
          <button
            className={mode === "paint" ? "selected" : ""}
            onClick={() => setMode("paint")}
          >
            <Paintbrush size={14} /> Paint
          </button>
          <button
            className={mode === "erase" ? "selected" : ""}
            onClick={() => setMode("erase")}
          >
            <Eraser size={14} /> Erase
          </button>
        </div>
        <label className="brush">
          Brush
          <input
            aria-label="Brush size"
            type="range"
            min="8"
            max="150"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <button
          className="icon-button"
          aria-label="Clear mask"
          onClick={() => {
            if (!mask.current) return;
            const ctx = mask.current.getContext("2d")!;
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, mask.current.width, mask.current.height);
            render();
          }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <p className="help">
        The highlighted area will be removed from the conditioning image. Cover
        facial features and ears; keep clothing visible. Drag to correct the
        mask.
      </p>
      <canvas
        ref={visible}
        aria-label="Reference face mask editor"
        onPointerDown={(e) => {
          if (!loaded) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          paint(e);
        }}
        onPointerMove={paint}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerCancel={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
      <ErrorMessage message={error} />
      <button
        className="primary full"
        disabled={!loaded || busy}
        onClick={() => void save()}
      >
        <ShieldCheck size={17} />
        {busy ? "Saving…" : "Approve protected reference"}
      </button>
    </div>
  );
}
