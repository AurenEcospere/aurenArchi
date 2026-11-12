import { useEffect, useRef, useState } from "react";
import {
  applyOperations,
  emptyModel,
  length,
  projectSchema,
  scaleFor,
  validateModel,
  type Model,
  type Point,
  type Project,
  type Proposal,
  type Source,
} from "../shared/model";
import { exportSvg } from "../shared/geometry";
import { sampleModel } from "../shared/sample";
import Plan, { type Tool } from "./Plan";
import Scene, { exportGlb } from "./scene";
import {
  download,
  listProjects,
  loadProject,
  parseProject,
  readDrawing,
  request,
  saveProject,
} from "./files";

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(Math.round(value * 1000) / 1000));
  useEffect(() => setText(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <label className="numeric">
      {label}
      <input
        aria-label={label}
        type="number"
        value={text}
        step="1"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next = Number(text);
          setText(String(Math.round(value * 1000) / 1000));
          if (text.trim() && Number.isFinite(next) && next !== value)
            onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <span>mm</span>
    </label>
  );
}
const newId = () => crypto.randomUUID();
const initial: Project = { model: structuredClone(sampleModel), source: null };
export default function App() {
  const [project, setProject] = useState<Project>(initial),
    projectRef = useRef(project);
  projectRef.current = project;
  const [past, setPast] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [tool, setTool] = useState<Tool>("select");
  const [marks, setMarks] = useState<Point[]>([]),
    [distance, setDistance] = useState("8000"),
    [opacity, setOpacity] = useState(0.45);
  const [file, setFile] = useState<File | null>(null),
    [pages, setPages] = useState(1),
    [page, setPage] = useState(1);
  const [draft, setDraft] = useState<{ model: Model; notes: string[] } | null>(
      null,
    ),
    [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(""),
    [message, setMessage] = useState(
      "Explore the sample, or upload your own floor plan.",
    ),
    [error, setError] = useState("");
  const [health, setHealth] = useState<{ ready: boolean; mode: string } | null>(
      null,
    ),
    [command, setCommand] = useState(""),
    [placementLabel, setPlacementLabel] = useState("Room");
  const [saved, setSaved] = useState<string[]>([]),
    [savedName, setSavedName] = useState("");
  const [style, setStyle] = useState(
      "Warm natural materials, soft daylight, contemporary interiors",
    ),
    [concept, setConcept] = useState<string | null>(null);
  const capture = useRef<(() => string) | null>(null);
  const base = draft?.model ?? project.model;
  let model = base;
  if (proposal && !proposal.clarification) {
    try {
      model = applyOperations(project.model, proposal);
    } catch {}
  }
  const issues = validateModel(base),
    editingLocked = Boolean(busy || proposal);
  const item = [
    ...base.walls,
    ...base.openings,
    ...base.furniture,
    ...base.rooms,
  ].find((e) => e.id === selected);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
    listProjects()
      .then(setSaved)
      .catch(() => {});
  }, []);
  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "Something went wrong.");
    setMessage("");
  }
  function commit(next: Project) {
    const prior = projectRef.current;
    const updated = {
      ...next,
      model: { ...next.model, revision: prior.model.revision + 1 },
    };
    setPast((p) => [...p.slice(-49), structuredClone(prior)]);
    setFuture([]);
    setProject(updated);
    projectRef.current = updated;
    setProposal(null);
    setError("");
  }
  function mutate(action: (next: Model) => void) {
    try {
      const next = structuredClone(base);
      action(next);
      const problems = validateModel(next);
      if (!draft && problems.length) throw new Error(problems.join(" "));
      if (draft) setDraft({ ...draft, model: next });
      else commit({ ...project, model: next });
      setError("");
    } catch (err) {
      fail(err);
    }
  }
  function setNumeric(property: string, value: number) {
    mutate((next) => {
      const w = next.walls.find((w) => w.id === selected);
      if (w && ["startX", "startY", "endX", "endY"].includes(property)) {
        const p = property.startsWith("start") ? w.start : w.end;
        p[property.endsWith("X") ? "x" : "y"] = value;
        return;
      }
      const element = [
        ...next.walls,
        ...next.openings,
        ...next.furniture,
        ...next.rooms,
      ].find((e) => e.id === selected);
      if (element && Object.hasOwn(element, property))
        (element as unknown as Record<string, unknown>)[property] = value;
    });
  }
  function history(redo: boolean) {
    const stack = redo ? future : past;
    if (!stack.length) return;
    const snapshot = structuredClone(stack[stack.length - 1]);
    snapshot.model.revision = project.model.revision + 1;
    if (redo) {
      setFuture(stack.slice(0, -1));
      setPast((p) => [...p, project]);
    } else {
      setPast(stack.slice(0, -1));
      setFuture((f) => [...f, project]);
    }
    setProject(snapshot);
    projectRef.current = snapshot;
    setProposal(null);
    setSelected(null);
    setMarks([]);
    setError("");
    setMessage(redo ? "Edit restored." : "Edit undone.");
  }
  function pickTool(next: Tool) {
    setTool(next);
    setMarks([]);
    setProposal(null);
  }
  async function upload(nextFile: File, nextPage = 1) {
    setBusy("Reading drawing");
    setError("");
    try {
      const result = await readDrawing(nextFile, nextPage);
      commit({
        model: emptyModel(nextFile.name.replace(/\.[^.]+$/, "")),
        source: result.source,
      });
      setFile(nextFile);
      setPages(result.pages);
      setPage(nextPage);
      setDraft(null);
      setSelected(null);
      setMarks([]);
      setTool("calibrate");
      setMessage(
        "Click two points on a known dimension, then confirm their distance.",
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }
  function point(p: Point) {
    if (editingLocked) return;
    if (tool === "calibrate") {
      if (!project.source) {
        fail(new Error("Upload a drawing first."));
        return;
      }
      let s = 1;
      if (project.source.calibration) s = scaleFor(project.source);
      const pixel = { x: p.x / s, y: p.y / s };
      setMarks((m) => (m.length >= 2 ? [pixel] : [...m, pixel]));
      return;
    }
    if (tool === "select") {
      setSelected(null);
      return;
    }
    if (project.source && !project.source.calibration) {
      fail(new Error("Confirm drawing scale before tracing."));
      return;
    }
    let snap = {
      x: Math.round(p.x / 100) * 100,
      y: Math.round(p.y / 100) * 100,
    };
    const endpoints = base.walls.flatMap((w) => [w.start, w.end]);
    const near = endpoints.find((a) => Math.hypot(a.x - p.x, a.y - p.y) < 150);
    if (near) snap = { ...near };
    if (tool === "wall") {
      if (!marks.length) {
        setMarks([snap]);
        return;
      }
      const id = newId();
      mutate((next) =>
        next.walls.push({
          id,
          label: "Wall " + (next.walls.length + 1),
          start: marks[0],
          end: snap,
          thickness: 200,
          height: 2800,
        }),
      );
      setMarks([]);
      setSelected(id);
    } else if (tool === "door" || tool === "window") {
      const hosts = base.walls
        .map((w) => {
          const l = length(w),
            ux = (w.end.x - w.start.x) / l,
            uy = (w.end.y - w.start.y) / l,
            t = (p.x - w.start.x) * ux + (p.y - w.start.y) * uy;
          return {
            w,
            t,
            d: Math.hypot(
              p.x - (w.start.x + ux * Math.max(0, Math.min(l, t))),
              p.y - (w.start.y + uy * Math.max(0, Math.min(l, t))),
            ),
          };
        })
        .sort((a, b) => a.d - b.d);
      const host = hosts[0],
        width = tool === "door" ? 900 : 1200;
      if (!host || host.d > 400 || length(host.w) < width) {
        fail(new Error("Click a wall long enough to host this opening."));
        return;
      }
      const id = newId();
      mutate((next) =>
        next.openings.push({
          id,
          label:
            (tool === "door" ? "Door " : "Window ") +
            (next.openings.length + 1),
          kind: tool,
          wallId: host.w.id,
          offset: Math.max(
            0,
            Math.min(length(host.w) - width, host.t - width / 2),
          ),
          width,
          height: tool === "door" ? 2100 : 1200,
          sillHeight: tool === "door" ? 0 : 900,
        }),
      );
      setSelected(id);
    } else if (tool === "room") {
      const id = newId();
      mutate((next) =>
        next.rooms.push({
          id,
          label: placementLabel.trim() || "Room",
          ...snap,
        }),
      );
      setSelected(id);
    } else if (tool === "furniture") {
      const id = newId();
      mutate((next) =>
        next.furniture.push({
          id,
          label: placementLabel.trim() || "Furniture",
          ...snap,
          width: 1000,
          depth: 600,
          height: 750,
        }),
      );
      setSelected(id);
    }
  }
  function calibrate() {
    try {
      if (!project.source || marks.length !== 2)
        throw new Error("Select two calibration points.");
      const mm = Number(distance);
      if (!Number.isFinite(mm) || mm <= 0)
        throw new Error("Enter a positive known distance in millimetres.");
      const source = {
        ...project.source,
        calibration: { a: marks[0], b: marks[1], distance: mm },
      };
      const nextScale = scaleFor(source);
      let next = project.model;
      if (project.source.calibration && project.model.walls.length) {
        const ratio = nextScale / scaleFor(project.source);
        next = structuredClone(next);
        next.walls.forEach((w) => {
          w.start.x *= ratio;
          w.start.y *= ratio;
          w.end.x *= ratio;
          w.end.y *= ratio;
          w.thickness *= ratio;
        });
        next.openings.forEach((o) => {
          o.offset *= ratio;
          o.width *= ratio;
        });
        next.rooms.forEach((r) => {
          r.x *= ratio;
          r.y *= ratio;
        });
        next.furniture.forEach((f) => {
          f.x *= ratio;
          f.y *= ratio;
          f.width *= ratio;
          f.depth *= ratio;
        });
      }
      const problems = validateModel(next);
      if (problems.length)
        throw new Error(
          "Recalibration creates geometry conflicts: " + problems.join(" "),
        );
      commit({ model: next, source });
      setDraft(null);
      setTool("select");
      setMarks([]);
      setMessage("Scale confirmed: " + nextScale.toFixed(3) + " mm per pixel.");
    } catch (err) {
      fail(err);
    }
  }
  async function extract() {
    const started = projectRef.current;
    setBusy("Interpreting floor plan");
    setError("");
    try {
      if (!started.source)
        throw new Error("Upload and calibrate a drawing first.");
      scaleFor(started.source);
      const data = await request<{ model: Model; notes: string[] }>(
        "extract-plan",
        {
          source: started.source,
          name: started.model.name,
          revision: started.model.revision,
        },
      );
      if (projectRef.current.model.revision !== started.model.revision)
        throw new Error("Project changed. Request a new draft.");
      setDraft({
        model: projectSchema.shape.model.parse(data.model),
        notes: data.notes,
      });
      setProposal(null);
      setTool("select");
      setMessage(
        "Review the draft over the drawing. Correct geometry, then accept it.",
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }
  async function propose() {
    setBusy("Preparing edit proposal");
    setError("");
    const started = projectRef.current;
    try {
      const result = await request<Proposal>("propose-edit", {
        model: started.model,
        command,
        selected,
      });
      if (projectRef.current.model.revision !== started.model.revision)
        throw new Error("Project changed. Request a new proposal.");
      if (!result.clarification) applyOperations(started.model, result);
      setProposal(result);
      setMessage(result.clarification ?? result.explanation);
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }
  async function generateConcept() {
    setBusy("Generating concept image");
    setError("");
    try {
      if (!capture.current) throw new Error("3D view is not ready.");
      const result = await request<{ image: string }>("concept-image", {
        image: concept ?? capture.current(),
        prompt: style,
      });
      setConcept(result.image);
      setMessage("Concept image ready. Your dimensioned model is unchanged.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }
  const calibrationMarks =
    tool === "calibrate" && project.source?.calibration
      ? marks.map((p) => ({
          x: p.x * scaleFor(project.source!),
          y: p.y * scaleFor(project.source!),
        }))
      : marks;
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Auren Arch home">
          <span className="brand-icon">A</span>
          <span>
            AUREN <strong>ARCH</strong>
            <small>Architectural workspace</small>
          </span>
        </a>
        <div className="project-title">
          <input
            aria-label="Project name"
            value={project.model.name}
            disabled={Boolean(busy || draft || proposal)}
            onChange={(e) => {
              if (e.target.value)
                commit({
                  ...project,
                  model: { ...project.model, name: e.target.value },
                });
            }}
          />
          <span>
            Single floor · {base.walls.length} walls · revision{" "}
            {project.model.revision}
          </span>
        </div>
        <div
          className={"ai-badge " + (health?.ready ? "ready" : "")}
          data-testid="ai-status"
        >
          <i />
          {health?.mode === "simulated"
            ? "Simulated AI · test"
            : health?.ready
              ? "OpenAI configured"
              : "API credentials pending"}
        </div>
      </header>
      <main className="workspace">
        <aside className="sidebar">
          <section>
            <div className="eyebrow">01 / SOURCE DRAWING</div>
            <h2>Start with a plan</h2>
            <p className="muted">
              Upload a single-floor drawing and set its scale.
            </p>
            <label className="upload">
              ↥ <strong>Upload floor plan</strong>
              <span>PDF, PNG or JPEG · max 20 MB</span>
              <input
                aria-label="Upload floor plan"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                disabled={Boolean(busy || draft || proposal)}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => {
                commit({ model: structuredClone(sampleModel), source: null });
                setDraft(null);
                setSelected(null);
                setPages(1);
                setFile(null);
                setMarks([]);
                setTool("select");
                setMessage("Sample project loaded.");
              }}
            >
              Load sample project
            </button>
            {project.source && (
              <>
                <div className="file-info">{project.source.filename}</div>
                {pages > 1 && (
                  <label>
                    PDF page
                    <select
                      aria-label="PDF page"
                      value={page}
                      disabled={Boolean(busy || draft || proposal)}
                      onChange={(e) => {
                        if (file) void upload(file, Number(e.target.value));
                      }}
                    >
                      {Array.from({ length: pages }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1} of {pages}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  disabled={Boolean(busy || draft || proposal)}
                  onClick={() => pickTool("calibrate")}
                >
                  Set scale · two points
                </button>
                <label>
                  Known distance (mm)
                  <input
                    aria-label="Known distance (mm)"
                    type="number"
                    min="1"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    marks.length !== 2 || tool !== "calibrate" || Boolean(busy)
                  }
                  onClick={calibrate}
                >
                  Confirm scale
                </button>
                <label>
                  Drawing opacity
                  <input
                    aria-label="Drawing opacity"
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                  />
                </label>
              </>
            )}
            <button
              className="primary"
              disabled={
                Boolean(busy || draft || proposal) ||
                !project.source?.calibration
              }
              onClick={() => void extract()}
            >
              ✦ Generate AI draft
            </button>
          </section>
          <section>
            <div className="eyebrow">02 / EDIT WITH INTENT</div>
            <h2>Tell us what to change</h2>
            <p className="muted">
              Select an element, then describe an edit. Review each proposal
              before applying.
            </p>
            <textarea
              aria-label="AI edit command"
              placeholder="Move the selected wall 300 mm to the right…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              rows={4}
            />
            <button
              className="primary"
              disabled={
                Boolean(busy || draft || proposal) ||
                !command.trim() ||
                Boolean(issues.length)
              }
              onClick={() => void propose()}
            >
              ✦ Preview AI edit
            </button>
            {proposal && (
              <div className="proposal">
                <strong>
                  {proposal.clarification
                    ? "Clarification needed"
                    : "Edit preview"}
                </strong>
                <p>{proposal.clarification ?? proposal.explanation}</p>
                {!proposal.clarification && (
                  <button
                    className="primary"
                    onClick={() => {
                      try {
                        commit({
                          ...project,
                          model: applyOperations(project.model, proposal),
                        });
                        setMessage("Edit applied to 2D and 3D.");
                      } catch (err) {
                        fail(err);
                      }
                    }}
                  >
                    Apply edit
                  </button>
                )}
                <button onClick={() => setProposal(null)}>
                  Dismiss proposal
                </button>
              </div>
            )}
          </section>
          <section>
            <div className="eyebrow">03 / PROJECT FILES</div>
            <div className="button-row">
              <button
                disabled={Boolean(draft || proposal || busy)}
                onClick={() =>
                  void saveProject(project)
                    .then(() => listProjects())
                    .then((names) => {
                      setSaved(names);
                      setMessage("Project saved locally.");
                      setError("");
                    })
                    .catch(fail)
                }
              >
                Save locally
              </button>
              <label className="button-label">
                Import JSON
                <input
                  aria-label="Import project JSON"
                  type="file"
                  accept=".json"
                  disabled={Boolean(draft || proposal || busy)}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    try {
                      if (f) {
                        const next = parseProject(JSON.parse(await f.text()));
                        commit(next);
                        setDraft(null);
                        setSelected(null);
                        setFile(null);
                        setPages(1);
                        setMessage("Project imported.");
                      }
                    } catch (err) {
                      fail(err);
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {saved.length > 0 && (
              <div className="button-row">
                <select
                  aria-label="Saved projects"
                  value={savedName}
                  onChange={(e) => setSavedName(e.target.value)}
                >
                  <option value="">Saved projects</option>
                  {saved.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
                <button
                  disabled={!savedName || Boolean(draft || proposal || busy)}
                  onClick={() =>
                    void loadProject(savedName)
                      .then((next) => {
                        commit(next);
                        setSelected(null);
                        setFile(null);
                        setPages(1);
                        setMessage("Saved project loaded.");
                      })
                      .catch(fail)
                  }
                >
                  Open
                </button>
              </div>
            )}
            <div className="export-row">
              <button
                disabled={Boolean(draft || proposal || busy)}
                onClick={() =>
                  download(
                    JSON.stringify(project, null, 2),
                    project.model.name + ".json",
                    "application/json",
                  )
                }
              >
                JSON ↓
              </button>
              <button
                disabled={Boolean(draft || proposal || busy)}
                onClick={() =>
                  download(
                    exportSvg(project.model),
                    project.model.name + ".svg",
                    "image/svg+xml",
                  )
                }
              >
                SVG ↓
              </button>
              <button
                disabled={Boolean(draft || proposal || busy)}
                onClick={() => void exportGlb(project.model).catch(fail)}
              >
                GLB ↓
              </button>
            </div>
          </section>
        </aside>
        <div className="design-area">
          <div className="status" role={error ? "alert" : "status"}>
            {busy ? (
              <>
                <span className="spinner" />
                {busy}…
              </>
            ) : (
              error || message
            )}
          </div>
          {draft && (
            <div className="review-banner">
              <div>
                <strong>AI draft · review required</strong>
                <span>
                  {issues.length
                    ? issues.length + " geometry issue(s) to correct"
                    : "Check walls, openings and dimensions against the source."}
                </span>
                <details>
                  <summary>Assumptions and issues</summary>
                  {[...draft.notes, ...issues].map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
                </details>
              </div>
              <button
                className="primary"
                disabled={Boolean(issues.length || busy)}
                onClick={() => {
                  commit({ ...project, model: draft.model });
                  setDraft(null);
                  setMessage("Reviewed model accepted.");
                }}
              >
                Accept reviewed draft
              </button>
              <button
                onClick={() => {
                  setDraft(null);
                  setSelected(null);
                  setMessage("Draft discarded. Accepted model preserved.");
                }}
              >
                Discard draft
              </button>
            </div>
          )}
          <div className="toolbar">
            <div className="tool-group">
              {(
                [
                  "select",
                  "wall",
                  "door",
                  "window",
                  "room",
                  "furniture",
                ] as const
              ).map((t) => (
                <button
                  key={t}
                  aria-pressed={tool === t}
                  className={tool === t ? "active" : ""}
                  disabled={editingLocked}
                  onClick={() => pickTool(t)}
                >
                  {
                    {
                      select: "↖ Select",
                      wall: "▱ Wall",
                      door: "↷ Door",
                      window: "▥ Window",
                      room: "T Room",
                      furniture: "▣ Furniture",
                    }[t]
                  }
                </button>
              ))}
            </div>
            <div className="tool-group">
              <button
                aria-label="Undo"
                disabled={!past.length || Boolean(draft) || editingLocked}
                onClick={() => history(false)}
              >
                ↶
              </button>
              <button
                aria-label="Redo"
                disabled={!future.length || Boolean(draft) || editingLocked}
                onClick={() => history(true)}
              >
                ↷
              </button>
            </div>
          </div>
          {(tool === "room" || tool === "furniture") && (
            <label className="placement">
              Placement label
              <input
                aria-label="Placement label"
                value={placementLabel}
                onChange={(e) => setPlacementLabel(e.target.value)}
              />
            </label>
          )}
          <div className="views">
            <section className="view-panel">
              <div className="panel-title">
                <h2>2D floor plan</h2>
                <span>Draw · measure · refine</span>
              </div>
              <Plan
                model={model}
                source={project.source}
                tool={tool}
                selected={selected}
                onSelect={setSelected}
                onPoint={point}
                marks={calibrationMarks}
                opacity={opacity}
              />
            </section>
            <section className="view-panel">
              <div className="panel-title">
                <h2>3D model</h2>
                <span>Orbit · scroll to zoom</span>
              </div>
              <div className="scene" data-testid="scene">
                <Scene
                  model={model}
                  selected={selected}
                  onSelect={setSelected}
                  capture={capture}
                />
              </div>
            </section>
          </div>
          <div className="bottom-strip">
            <span>
              <i className="dot" />{" "}
              {draft
                ? "Draft geometry"
                : proposal
                  ? "Proposed geometry"
                  : "Accepted geometry"}{" "}
              · 2D + 3D synchronized
            </span>
            <span data-testid="geometry-summary">
              {model.walls.length} walls · {model.openings.length} openings ·{" "}
              {model.furniture.length} objects
            </span>
          </div>
          <section className="concept-section">
            <div>
              <div className="eyebrow">CONCEPT VISUALS</div>
              <h2>Explore the atmosphere</h2>
              <p className="muted">
                Create an illustration from the 3D view. Review dimensions in
                the model.
              </p>
            </div>
            <textarea
              aria-label="Concept image prompt"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              rows={2}
            />
            <button
              disabled={Boolean(busy || draft || proposal) || !style.trim()}
              onClick={() => void generateConcept()}
            >
              {concept ? "Edit concept image" : "Generate concept image"}
            </button>
            {concept && (
              <div className="concept-result">
                <img
                  src={concept}
                  alt="Generated architectural concept illustration"
                />
                <a href={concept} download="auren-concept.png">
                  Download image ↓
                </a>
                <button onClick={() => setConcept(null)}>
                  Use model as next reference
                </button>
              </div>
            )}
          </section>
        </div>
        <aside className="inspector">
          <div className="eyebrow">ELEMENT INSPECTOR</div>
          <label>
            Element
            <select
              aria-label="Select element"
              value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value || null)}
            >
              <option value="">Choose an element</option>
              {[
                ...base.walls,
                ...base.openings,
                ...base.furniture,
                ...base.rooms,
              ].map((element) => (
                <option key={element.id} value={element.id}>
                  {element.label}
                </option>
              ))}
            </select>
          </label>
          <h2>{item?.label ?? "Select an element"}</h2>
          {!item ? (
            <p className="muted">
              Click a wall, opening, label or object in either view to inspect
              its dimensions.
            </p>
          ) : (
            <fieldset disabled={editingLocked}>
              <label>
                Element label
                <input
                  aria-label="Element label"
                  key={item.id + item.label}
                  defaultValue={item.label}
                  onBlur={(e) => {
                    if (e.target.value !== item.label)
                      mutate((next) => {
                        const target = [
                          ...next.walls,
                          ...next.openings,
                          ...next.furniture,
                          ...next.rooms,
                        ].find((x) => x.id === selected);
                        if (target) target.label = e.target.value;
                      });
                  }}
                />
              </label>
              {"start" in item && (
                <>
                  <div className="measurement">
                    {Math.round(length(item))}
                    <small>WALL LENGTH · MM</small>
                  </div>
                  <NumberField
                    label="Start X"
                    value={item.start.x}
                    onChange={(v) => setNumeric("startX", v)}
                  />
                  <NumberField
                    label="Start Y"
                    value={item.start.y}
                    onChange={(v) => setNumeric("startY", v)}
                  />
                  <NumberField
                    label="End X"
                    value={item.end.x}
                    onChange={(v) => setNumeric("endX", v)}
                  />
                  <NumberField
                    label="End Y"
                    value={item.end.y}
                    onChange={(v) => setNumeric("endY", v)}
                  />
                </>
              )}
              {"wallId" in item && (
                <label>
                  Host wall
                  <select
                    aria-label="Host wall"
                    value={item.wallId}
                    onChange={(e) =>
                      mutate((next) => {
                        const o = next.openings.find((o) => o.id === selected);
                        if (o) o.wallId = e.target.value;
                      })
                    }
                  >
                    {base.walls.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(
                [
                  "x",
                  "y",
                  "width",
                  "depth",
                  "height",
                  "thickness",
                  "offset",
                  "sillHeight",
                ] as const
              )
                .filter((k) => k in item)
                .map((k) => (
                  <NumberField
                    key={item.id + k}
                    label={
                      {
                        x: "Position X",
                        y: "Position Y",
                        width: "Width",
                        depth: "Depth",
                        height: "Height",
                        thickness: "Thickness",
                        offset: "Wall offset",
                        sillHeight: "Sill height",
                      }[k]
                    }
                    value={(item as unknown as Record<string, number>)[k]}
                    onChange={(v) => setNumeric(k, v)}
                  />
                ))}
              <button
                className="danger"
                onClick={() => {
                  mutate((next) => {
                    next.walls = next.walls.filter((x) => x.id !== selected);
                    next.openings = next.openings.filter(
                      (x) => x.id !== selected && x.wallId !== selected,
                    );
                    next.rooms = next.rooms.filter((x) => x.id !== selected);
                    next.furniture = next.furniture.filter(
                      (x) => x.id !== selected,
                    );
                  });
                  setSelected(null);
                }}
              >
                Delete element
              </button>
            </fieldset>
          )}
          <div className="validation">
            <h3>Geometry checks</h3>
            {issues.length ? (
              <ul>
                {issues.map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
            ) : (
              <p>
                <span className="check">✓</span> No geometry conflicts detected
              </p>
            )}
            <p className="muted small">
              Checks cover dimensions, hosted openings, furniture collisions and
              a 600 mm door review zone. Room labels do not define measured
              areas.
            </p>
          </div>
        </aside>
      </main>
      <footer>
        Auren Ecosphere{" "}
        <span>Single-floor internal prototype · Local project storage</span>
      </footer>
    </div>
  );
}
