"use client";
import { getStroke } from "perfect-freehand";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";

type Pt = [number, number, number];
type Op = { kind: "stroke"; color: string; size: number; points: Pt[]; erase: boolean } | { kind: "fill"; color: string; x: number; y: number };

const PAPER = "#f2ede3";
const COLORS = ["#1b1712", "#f2ede3", "#e11d48", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#8b5a2b", "#9ca3af"];
const W = 800;
const H = 600;

function pathFrom(stroke: number[][]) {
  if (!stroke.length) return new Path2D();
  const p = new Path2D();
  p.moveTo(stroke[0][0], stroke[0][1]);
  for (let i = 1; i < stroke.length; i++) {
    const [x0, y0] = stroke[i - 1];
    const [x1, y1] = stroke[i];
    p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  p.closePath();
  return p;
}

/** Flood fill on the canvas pixels (tolerance for anti-aliased edges). */
function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const i0 = (Math.floor(y) * W + Math.floor(x)) * 4;
  const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  if (target[0] === rgb[0] && target[1] === rgb[1] && target[2] === rgb[2]) return;
  const near = (i: number) => Math.abs(d[i] - target[0]) + Math.abs(d[i + 1] - target[1]) + Math.abs(d[i + 2] - target[2]) + Math.abs(d[i + 3] - target[3]) < 60;
  const stack = [Math.floor(x) + Math.floor(y) * W];
  const seen = new Uint8Array(W * H);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!near(i)) continue;
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
    d[i + 3] = 255;
    const px = p % W;
    if (px > 0) stack.push(p - 1);
    if (px < W - 1) stack.push(p + 1);
    if (p >= W) stack.push(p - W);
    if (p < W * (H - 1)) stack.push(p + W);
  }
  ctx.putImageData(img, 0, 0);
}

export default function DrawCanvas({ onExport, disabled }: { onExport: (png: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [redo, setRedo] = useState<Op[]>([]);
  const [color, setColor] = useState("#1b1712");
  const [size, setSize] = useState(8);
  const [tool, setTool] = useState<"pen" | "eraser" | "fill">("pen");
  const current = useRef<Pt[] | null>(null);

  const redraw = useCallback(
    (list: Op[], live?: Op) => {
      const ctx = ref.current!.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
      for (const op of live ? [...list, live] : list) {
        if (op.kind === "fill") floodFill(ctx, op.x, op.y, op.color);
        else {
          ctx.fillStyle = op.erase ? PAPER : op.color;
          ctx.fill(pathFrom(getStroke(op.points, { size: op.size, thinning: op.erase ? 0 : 0.5, smoothing: 0.5, streamline: 0.5 })));
        }
      }
    },
    [],
  );

  useEffect(() => redraw(ops), [ops, redraw]);

  const pos = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H, e.pressure || 0.5];
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {COLORS.map((c) => (
          <button key={c} aria-label={c} className={`h-7 w-7 rounded-sm transition ${color === c && tool !== "eraser" ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : "ring-1 ring-line"}`} style={{ background: c }} onClick={() => (setColor(c), tool === "eraser" && setTool("pen"))} />
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 cursor-pointer rounded-sm bg-transparent" aria-label="colour" />
        <select className="field h-9 w-auto px-2" value={size} onChange={(e) => setSize(Number(e.target.value))}>
          {[3, 6, 10, 16, 28, 48].map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
        <button className={`toggle ${tool === "pen" ? "toggle-on" : ""}`} onClick={() => setTool("pen")}>
          <Icon name="Pen" size={16} /> قلم
        </button>
        <button className={`toggle ${tool === "eraser" ? "toggle-on" : ""}`} onClick={() => setTool("eraser")}>
          <Icon name="Eraser" size={16} /> ممحاة
        </button>
        <button className={`toggle ${tool === "fill" ? "toggle-on" : ""}`} onClick={() => setTool("fill")}>
          <Icon name="PaintBucket" size={16} /> تعبئة
        </button>
        <button className="toggle" aria-label="undo" disabled={!ops.length} onClick={() => (setRedo((r) => [ops[ops.length - 1], ...r]), setOps((o) => o.slice(0, -1)))}>
          <Icon name="Undo2" size={16} /> تراجع
        </button>
        <button className="toggle" aria-label="redo" disabled={!redo.length} onClick={() => (setOps((o) => [...o, redo[0]]), setRedo((r) => r.slice(1)))}>
          <Icon name="Redo2" size={16} /> إعادة
        </button>
        <button className="toggle" onClick={() => (setOps([]), setRedo([]))}>
          <Icon name="Trash2" size={16} /> مسح
        </button>
      </div>
      <canvas
        ref={ref}
        width={W}
        height={H}
        className="paper w-full touch-none rounded-md"
        style={{ aspectRatio: `${W}/${H}` }}
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const p = pos(e);
          if (tool === "fill") {
            setOps((o) => [...o, { kind: "fill", color, x: p[0], y: p[1] }]);
            setRedo([]);
            return;
          }
          current.current = [p];
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          current.current.push(pos(e));
          redraw(ops, { kind: "stroke", color, size: tool === "eraser" ? size * 2 : size, points: current.current, erase: tool === "eraser" });
        }}
        onPointerUp={() => {
          if (!current.current) return;
          const pts = current.current;
          current.current = null;
          setOps((o) => [...o, { kind: "stroke", color, size: tool === "eraser" ? size * 2 : size, points: pts, erase: tool === "eraser" }]);
          setRedo([]);
        }}
      />
      <button className="btn-primary w-full" disabled={disabled} onClick={() => onExport(ref.current!.toDataURL("image/png"))}>
        <Icon name="Check" size={18} /> خلصت، أرسل الرسمة
      </button>
    </div>
  );
}
