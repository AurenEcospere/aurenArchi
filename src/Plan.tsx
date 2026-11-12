import { useState, type MouseEvent } from "react";
import { bounds, openingPosition } from "../shared/geometry";
import {
  length,
  scaleFor,
  type Model,
  type Source,
  type Point,
} from "../shared/model";
export type Tool =
  | "select"
  | "wall"
  | "door"
  | "window"
  | "room"
  | "furniture"
  | "calibrate";
export default function Plan({
  model,
  source,
  tool,
  selected,
  onSelect,
  onPoint,
  marks,
  opacity,
}: {
  model: Model;
  source: Source | null;
  tool: Tool;
  selected: string | null;
  onSelect: (id: string) => void;
  onPoint: (p: Point) => void;
  marks: Point[];
  opacity: number;
}) {
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  let scale = 1;
  if (source?.calibration) {
    try {
      scale = scaleFor(source);
    } catch {}
  }
  let b = bounds(model);
  if (source) {
    const minX = Math.min(0, b.x),
      minY = Math.min(0, b.y);
    b = {
      x: minX,
      y: minY,
      width: Math.max(source.width * scale, b.x + b.width) - minX,
      height: Math.max(source.height * scale, b.y + b.height) - minY,
    };
    if (!model.walls.length)
      b = {
        x: 0,
        y: 0,
        width: source.width * scale,
        height: source.height * scale,
      };
  }
  const vw = b.width / zoom,
    vh = b.height / zoom,
    x = b.x + (b.width - vw) / 2 + pan.x,
    y = b.y + (b.height - vh) / 2 + pan.y;
  function click(e: MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget,
      point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const matrix = svg.getScreenCTM();
    if (matrix) {
      const p = point.matrixTransform(matrix.inverse());
      onPoint({ x: p.x, y: p.y });
    }
  }
  function select(e: MouseEvent, id: string) {
    if (tool === "select") {
      e.stopPropagation();
      onSelect(id);
    }
  }
  return (
    <div className={"plan-surface tool-" + tool}>
      <svg
        aria-label="2D floor plan"
        data-testid="plan"
        viewBox={[x, y, vw, vh].join(" ")}
        onClick={click}
      >
        <defs>
          <pattern
            id="grid"
            width={source && !source.calibration ? 50 : 500}
            height={source && !source.calibration ? 50 : 500}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={
                "M " +
                (source && !source.calibration ? 50 : 500) +
                " 0 L 0 0 0 " +
                (source && !source.calibration ? 50 : 500)
              }
              fill="none"
              stroke="#c9d6cc"
              strokeWidth={b.width / 1500}
            />
          </pattern>
        </defs>
        <rect x={x} y={y} width={vw} height={vh} fill="url(#grid)" />
        {source && (
          <image
            href={source.dataUrl}
            width={source.width * scale}
            height={source.height * scale}
            opacity={opacity}
            pointerEvents="none"
          />
        )}
        {model.walls.map((w) => (
          <g
            key={w.id}
            role="button"
            tabIndex={0}
            aria-label={w.label}
            data-element-id={w.id}
            onClick={(e) => select(e, w.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(w.id);
            }}
          >
            <line
              x1={w.start.x}
              y1={w.start.y}
              x2={w.end.x}
              y2={w.end.y}
              stroke={selected === w.id ? "#15957a" : "#25493e"}
              strokeWidth={Math.max(w.thickness, b.width / 400)}
              strokeLinecap="square"
            />
            <text
              x={(w.start.x + w.end.x) / 2}
              y={(w.start.y + w.end.y) / 2 - 100}
              textAnchor="middle"
              fontSize={b.width / 85}
              fill="#547568"
              pointerEvents="none"
            >
              {Math.round(length(w))} mm
            </text>
          </g>
        ))}
        {model.openings.map((o) => {
          const w = model.walls.find((w) => w.id === o.wallId);
          if (!w) return null;
          const a = openingPosition(w, o.offset),
            p = openingPosition(w, o.offset + o.width);
          return (
            <g
              key={o.id}
              role="button"
              tabIndex={0}
              aria-label={o.label}
              onClick={(e) => select(e, o.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(o.id);
              }}
            >
              <line
                x1={a.x}
                y1={a.y}
                x2={p.x}
                y2={p.y}
                stroke={
                  selected === o.id
                    ? "#edb33c"
                    : o.kind === "door"
                      ? "#f7f8ee"
                      : "#8cc6ce"
                }
                strokeWidth={w.thickness + 10}
              />
              <line
                x1={a.x}
                y1={a.y}
                x2={p.x}
                y2={p.y}
                stroke={o.kind === "door" ? "#ba935f" : "#408b99"}
                strokeWidth={b.width / 600}
              />
            </g>
          );
        })}
        {model.furniture.map((f) => (
          <g
            key={f.id}
            role="button"
            tabIndex={0}
            aria-label={f.label}
            onClick={(e) => select(e, f.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(f.id);
            }}
          >
            <rect
              x={f.x - f.width / 2}
              y={f.y - f.depth / 2}
              width={f.width}
              height={f.depth}
              rx={60}
              fill={selected === f.id ? "#8dc5ae" : "#dbc9ac"}
              stroke="#a78c61"
              strokeWidth={15}
            />
            <text x={f.x} y={f.y} textAnchor="middle" fontSize={b.width / 90}>
              {f.label}
            </text>
          </g>
        ))}
        {model.rooms.map((r) => (
          <text
            key={r.id}
            role="button"
            tabIndex={0}
            aria-label={r.label}
            x={r.x}
            y={r.y}
            textAnchor="middle"
            fontSize={b.width / 65}
            fill={selected === r.id ? "#12967c" : "#284c42"}
            onClick={(e) => select(e, r.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(r.id);
            }}
          >
            {r.label}
          </text>
        ))}
        {marks.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={b.width / 100}
            fill="#e6a33b"
            stroke="white"
            strokeWidth={b.width / 500}
          />
        ))}
        {marks.length === 2 && (
          <line
            x1={marks[0].x}
            y1={marks[0].y}
            x2={marks[1].x}
            y2={marks[1].y}
            stroke="#e6a33b"
            strokeWidth={b.width / 400}
          />
        )}
      </svg>
      <div className="canvas-controls">
        <button
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(8, z * 1.3))}
        >
          ＋
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.3))}
        >
          −
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
        <button
          aria-label="Pan left"
          onClick={() => setPan((p) => ({ ...p, x: p.x - vw / 5 }))}
        >
          ←
        </button>
        <button
          aria-label="Pan right"
          onClick={() => setPan((p) => ({ ...p, x: p.x + vw / 5 }))}
        >
          →
        </button>
        <button
          aria-label="Pan up"
          onClick={() => setPan((p) => ({ ...p, y: p.y - vh / 5 }))}
        >
          ↑
        </button>
        <button
          aria-label="Pan down"
          onClick={() => setPan((p) => ({ ...p, y: p.y + vh / 5 }))}
        >
          ↓
        </button>
      </div>
      <span className="canvas-note">
        {source && !source.calibration
          ? "Scale unconfirmed"
          : "Dimensions in millimetres"}{" "}
        ·{" "}
        {tool === "select"
          ? "Select an element"
          : tool === "wall"
            ? "Click two endpoints"
            : tool === "calibrate"
              ? "Click two points on a known dimension"
              : "Click to place " + tool}
      </span>
    </div>
  );
}
