import { openDB } from "idb";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  projectSchema,
  validateModel,
  type Project,
  type Source,
} from "../shared/model";
GlobalWorkerOptions.workerSrc = workerUrl;
export async function readDrawing(
  file: File,
  pageNumber = 1,
): Promise<{ source: Source; pages: number }> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Maximum upload size is 20 MB.");
  const pdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  let canvas: HTMLCanvasElement;
  let pages = 1;
  if (pdf) {
    const task = getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    });
    const doc = await task.promise;
    try {
      pages = doc.numPages;
      if (pageNumber > pages) throw new Error("PDF page does not exist.");
      const page = await doc.getPage(pageNumber),
        natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 2000 / Math.max(natural.width, natural.height)),
      });
      canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
    } finally {
      await task.destroy();
    }
  } else {
    if (!["image/png", "image/jpeg"].includes(file.type))
      throw new Error("Use a PNG, JPEG, or PDF drawing.");
    const bitmap = await createImageBitmap(file),
      factor = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * factor);
    canvas.height = Math.round(bitmap.height * factor);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  }
  return {
    source: {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      filename: file.name,
      page: pageNumber,
      calibration: null,
    },
    pages,
  };
}
const database = () =>
  openDB("auren-arch", 1, {
    upgrade(db) {
      db.createObjectStore("projects");
    },
  });
export async function saveProject(project: Project) {
  const db = await database();
  await db.put("projects", project, project.model.name);
  db.close();
}
export async function listProjects(): Promise<string[]> {
  const db = await database();
  const keys = await db.getAllKeys("projects");
  db.close();
  return keys.map(String);
}
export async function loadProject(name: string): Promise<Project> {
  const db = await database();
  const data = await db.get("projects", name);
  db.close();
  return parseProject(data);
}
export function parseProject(data: unknown): Project {
  const project = projectSchema.parse(data);
  const issues = validateModel(project.model);
  if (issues.length) throw new Error(issues.join(" "));
  return project;
}
export function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}
