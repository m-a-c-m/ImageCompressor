"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { zipSync } from "fflate";
import { FiUploadCloud, FiDownload, FiX, FiArchive } from "react-icons/fi";

interface Props { locale?: string; }

type OutFormat = "keep" | "jpeg" | "webp" | "png";

interface Item {
  id: string;
  name: string;
  origSize: number;
  outSize: number;
  blob: Blob;
  url: string;
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

function mimeFor(fmt: OutFormat, origType: string): string {
  if (fmt === "jpeg") return "image/jpeg";
  if (fmt === "webp") return "image/webp";
  if (fmt === "png") return "image/png";
  return origType === "image/png" ? "image/png" : "image/jpeg";
}

function extFor(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export default function ImageCompressor({ locale = "es" }: Props) {
  const isEs = locale === "es";
  const [quality, setQuality] = useState(0.7);
  const [format, setFormat] = useState<OutFormat>("keep");
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const compressOne = useCallback(async (file: File, q: number, fmt: OutFormat): Promise<Item> => {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const mime = mimeFor(fmt, file.type);
    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b ?? new Blob()), mime, mime === "image/png" ? undefined : q)
    );
    const base = file.name.replace(/\.[^.]+$/, "");
    return {
      id: `${file.name}-${Math.random().toString(36).slice(2)}`,
      name: `${base}.${extFor(mime)}`,
      origSize: file.size,
      outSize: blob.size,
      blob,
      url: URL.createObjectURL(blob),
    };
  }, []);

  const onFiles = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const imgs = [...list].filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    setFiles((prev) => [...prev, ...imgs]);
  }, []);

  // Reprocess live whenever the originals or settings change (debounced).
  useEffect(() => {
    if (files.length === 0) { setItems([]); return; }
    let cancelled = false;
    setBusy(true);
    const handle = setTimeout(async () => {
      const out: Item[] = [];
      for (const f of files) { try { out.push(await compressOne(f, quality, format)); } catch { /* */ } }
      if (cancelled) { out.forEach((o) => URL.revokeObjectURL(o.url)); return; }
      setItems((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return out; });
      setBusy(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [files, quality, format, compressOne]);

  const downloadOne = (it: Item) => {
    const a = document.createElement("a");
    a.href = it.url; a.download = it.name; a.click();
  };

  const downloadZip = () => {
    const files: Record<string, Uint8Array> = {};
    let pending = items.length;
    if (pending === 0) return;
    items.forEach((it) => {
      it.blob.arrayBuffer().then((buf) => {
        files[it.name] = new Uint8Array(buf);
        if (--pending === 0) {
          const zipped = zipSync(files, { level: 0 });
          const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "compressed-images.zip";
          a.click();
          URL.revokeObjectURL(a.href);
        }
      });
    });
  };

  const clear = () => {
    items.forEach((it) => URL.revokeObjectURL(it.url));
    setItems([]);
    setFiles([]);
  };

  const totalOrig = items.reduce((a, it) => a + it.origSize, 0);
  const totalOut = items.reduce((a, it) => a + it.outSize, 0);
  const saved = totalOrig > 0 ? Math.round((1 - totalOut / totalOrig) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/20 bg-surface/30 p-4">
        <div className="flex flex-1 items-center gap-3">
          <span className="text-xs text-text-muted">{isEs ? "Calidad" : "Quality"}</span>
          <input type="range" min={0.1} max={1} step={0.05} value={quality}
            onChange={(e) => setQuality(parseFloat(e.target.value))}
            className="flex-1 accent-primary" />
          <span className="w-10 text-right text-xs font-medium text-text">{Math.round(quality * 100)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{isEs ? "Formato" : "Format"}</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as OutFormat)}
            className="rounded-lg border border-border/30 bg-surface/60 px-2 py-1.5 text-xs text-text outline-none">
            <option value="keep">{isEs ? "Mantener" : "Keep"}</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
            <option value="png">PNG</option>
          </select>
        </div>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${dragOver ? "border-primary/60 bg-primary/5" : "border-border/40 bg-surface/30 hover:border-primary/40"}`}
      >
        <FiUploadCloud className="text-3xl text-primary/70" />
        <p className="text-sm font-medium text-text">{isEs ? "Arrastra imágenes o haz clic (varias a la vez)" : "Drag images or click (multiple at once)"}</p>
        <p className="text-xs text-text-muted/60">{isEs ? "JPG, PNG, WebP · 100% en tu navegador" : "JPG, PNG, WebP · 100% in your browser"}</p>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </div>

      {busy && <p className="text-center text-xs text-text-muted/60">{isEs ? "Comprimiendo…" : "Compressing…"}</p>}

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-3">
            <p className="text-sm text-green-400">
              {isEs
                ? `${items.length} imágenes · ${fmtSize(totalOrig)} → ${fmtSize(totalOut)} · ahorro ${saved}%`
                : `${items.length} images · ${fmtSize(totalOrig)} → ${fmtSize(totalOut)} · ${saved}% saved`}
            </p>
            <div className="flex gap-2">
              <button onClick={downloadZip} className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20">
                <FiArchive /> ZIP
              </button>
              <button onClick={clear} className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-surface/40 px-3 py-1.5 text-xs text-text-muted hover:text-text">
                <FiX /> {isEs ? "Limpiar" : "Clear"}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((it) => {
              const pct = it.origSize > 0 ? Math.round((1 - it.outSize / it.origSize) * 100) : 0;
              return (
                <div key={it.id} className="flex items-center gap-3 rounded-xl border border-border/20 bg-surface/30 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-text">{it.name}</p>
                    <p className="text-xs text-text-muted/60">
                      {fmtSize(it.origSize)} → {fmtSize(it.outSize)}{" "}
                      <span className={pct >= 0 ? "text-green-400" : "text-orange-400"}>({pct >= 0 ? "-" : "+"}{Math.abs(pct)}%)</span>
                    </p>
                  </div>
                  <button onClick={() => downloadOne(it)} className="shrink-0 rounded-lg border border-border/30 p-2 text-text-muted hover:text-primary">
                    <FiDownload className="text-sm" />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
