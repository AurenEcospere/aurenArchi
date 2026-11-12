import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { type Fixture } from "../layouts";
const fixtures: Fixture[] = JSON.parse(
  await fs.readFile("tests/fixtures/manifest.json", "utf8"),
);
async function clickWorld(page: Page, x: number, y: number) {
  const point = await page.getByTestId("plan").evaluate(
    (el, point) => {
      const svg = el as SVGSVGElement,
        p = svg.createSVGPoint();
      p.x = point.x;
      p.y = point.y;
      const mapped = p.matrixTransform(svg.getScreenCTM()!);
      return { x: mapped.x, y: mapped.y };
    },
    { x, y },
  );
  await page.mouse.click(point.x, point.y);
}
async function exportProject(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON ↓", exact: true }).click();
  const file = await pending;
  return JSON.parse(await fs.readFile((await file.path())!, "utf8"));
}
async function simulate(page: Page) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { ready: true, mode: "simulated", models: {} } }),
  );
}
for (const fixture of fixtures)
  test("simulated AI workflow / " + fixture.id, async ({ page }, info) => {
    await simulate(page);
    await page.route("**/api/extract-plan", async (route) => {
      const body = route.request().postDataJSON();
      expect(body.source.calibration.distance).toBeCloseTo(
        Math.hypot(
          fixture.model.walls[0].end.x - fixture.model.walls[0].start.x,
          fixture.model.walls[0].end.y - fixture.model.walls[0].start.y,
        ),
        0,
      );
      await route.fulfill({
        json: {
          model: { ...fixture.model, revision: body.revision },
          notes: [
            fixture.degraded
              ? "Simulated draft for degraded upload; real recognition is pending."
              : "Simulated extraction: verify dimensions.",
          ],
        },
      });
    });
    await page.goto("/");
    await expect(page.getByTestId("ai-status")).toContainText("Simulated");
    await page
      .getByLabel("Upload floor plan", { exact: true })
      .setInputFiles(fixture.file);
    await expect(page.getByRole("status")).toContainText("Click two points");
    const pixelWidth = await page
      .getByTestId("plan")
      .evaluate((el) => Number((el as SVGSVGElement).viewBox.baseVal.width));
    const ratio = pixelWidth / fixture.source.width;
    await clickWorld(
      page,
      fixture.source.calibration!.a.x * ratio,
      fixture.source.calibration!.a.y * ratio,
    );
    await clickWorld(
      page,
      fixture.source.calibration!.b.x * ratio,
      fixture.source.calibration!.b.y * ratio,
    );
    await page
      .getByLabel("Known distance (mm)")
      .fill(String(fixture.source.calibration!.distance));
    await page
      .getByRole("button", { name: "Confirm scale", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Scale confirmed");
    await page.getByRole("button", { name: "Generate AI draft" }).click();
    await expect(page.getByText("AI draft · review required")).toBeVisible();
    await page.getByRole("button", { name: "Accept reviewed draft" }).click();
    await expect(page.getByTestId("geometry-summary")).toContainText(
      fixture.model.walls.length + " walls",
    );
    await expect(page.getByTestId("scene").locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "North wall", exact: true }).click();
    await expect(page.getByLabel("Start X", { exact: true })).toHaveValue(
      String(fixture.model.walls[0].start.x),
    );
    await page.getByLabel("Thickness", { exact: true }).fill("220");
    await page.getByLabel("Thickness", { exact: true }).press("Enter");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("saved locally");
    let exported = await exportProject(page);
    expect(exported.model.walls[0].thickness).toBe(220);
    expect(exported.source.calibration.distance).toBe(
      fixture.source.calibration!.distance,
    );
    await page.reload();
    await page.getByLabel("Saved projects").selectOption(fixture.model.name);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Saved project loaded",
    );
    exported = await exportProject(page);
    expect(exported.model.walls[0].thickness).toBe(220);
    await info.attach("reviewed-workspace", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
test("manual tracing, room labels, openings, editing, undo/redo and project import", async ({
  page,
}) => {
  await page.goto("/");
  const fixture = fixtures[0];
  await page
    .getByLabel("Upload floor plan", { exact: true })
    .setInputFiles(fixture.file);
  await expect(page.getByRole("status")).toContainText("Click two points");
  await clickWorld(page, 100, 100);
  await clickWorld(page, 600, 100);
  await page.getByLabel("Known distance (mm)").fill("6250");
  await page.getByRole("button", { name: "Confirm scale" }).click();
  await page
    .getByRole("button", { name: "Wall", exact: false })
    .filter({ hasText: "▱ Wall" })
    .click();
  await clickWorld(page, 2000, 2000);
  await clickWorld(page, 8000, 2000);
  await expect(page.getByTestId("geometry-summary")).toContainText("1 walls");
  await page
    .getByRole("button", { name: "Door", exact: false })
    .filter({ hasText: "↷ Door" })
    .click();
  await clickWorld(page, 4000, 2000);
  await expect(page.getByTestId("geometry-summary")).toContainText(
    "1 openings",
  );
  await page
    .getByRole("button", { name: "Room", exact: false })
    .filter({ hasText: "T Room" })
    .click();
  await page.getByLabel("Placement label").fill("Test room");
  await clickWorld(page, 4000, 4000);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  let data = await exportProject(page);
  expect(data.model.rooms).toHaveLength(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  data = await exportProject(page);
  expect(data.model.rooms[0].label).toBe("Test room");
  expect(data.model.walls[0].end.x - data.model.walls[0].start.x).toBe(6000);
  await page
    .getByLabel("Import project JSON")
    .setInputFiles({
      name: "project.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await expect(page.getByRole("status")).toContainText("Project imported");
  expect((await exportProject(page)).model.rooms[0].label).toBe("Test room");
});
test("AI edit preview, discard, acceptance, ambiguity and rejected conflicts", async ({
  page,
}) => {
  await simulate(page);
  await page.route("**/api/propose-edit", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "ambiguous") {
      await route.fulfill({
        json: {
          revision: body.model.revision,
          explanation: "",
          clarification: "Which wall should move?",
          operations: [],
        },
      });
      return;
    }
    if (body.command === "invalid") {
      await route.fulfill({
        status: 422,
        json: { error: "Opening extends beyond its wall." },
      });
      return;
    }
    await route.fulfill({
      json: {
        revision: body.model.revision,
        explanation: "Move north wall right 300 mm.",
        clarification: null,
        operations: [{ type: "move", id: "w1", dx: 300, dy: 0 }],
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("AI edit command").fill("move north wall right 300 mm");
  await page.getByRole("button", { name: "Preview AI edit" }).click();
  await expect(page.getByText("Edit preview", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss proposal" }).click();
  expect((await exportProject(page)).model.walls[0].start.x).toBe(0);
  await page.getByRole("button", { name: "Preview AI edit" }).click();
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  expect((await exportProject(page)).model.walls[0].start.x).toBe(300);
  await page.getByLabel("AI edit command").fill("ambiguous");
  await page.getByRole("button", { name: "Preview AI edit" }).click();
  await expect(
    page.getByText("Clarification needed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply edit", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss proposal" }).click();
  await page.getByLabel("AI edit command").fill("invalid");
  await page.getByRole("button", { name: "Preview AI edit" }).click();
  await expect(page.getByRole("alert")).toContainText("beyond");
  expect((await exportProject(page)).model.walls[0].start.x).toBe(300);
});
test("SVG scale and GLB reload preserve wall lengths and actual door holes", async ({
  page,
}) => {
  await page.goto("/");
  let pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "SVG ↓" }).click();
  let file = await pending;
  const svg = await fs.readFile((await file.path())!, "utf8");
  expect(svg).toContain('width="8600mm"');
  pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "GLB ↓" }).click();
  file = await pending;
  const glb = await fs.readFile((await file.path())!);
  expect(glb.subarray(0, 4).toString()).toBe("glTF");
  const array = glb.buffer.slice(
    glb.byteOffset,
    glb.byteOffset + glb.byteLength,
  );
  const loaded = await new GLTFLoader().parseAsync(array, "");
  const bounds = new THREE.Box3().setFromObject(loaded.scene);
  expect(bounds.max.x - bounds.min.x).toBeCloseTo(8.6, 4);
  const north: THREE.Mesh[] = [];
  loaded.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name.startsWith("w1")) north.push(o);
  });
  expect(north.length).toBeGreaterThan(1);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(1.3, 1, 5.5),
    new THREE.Vector3(0, 0, 1),
  );
  expect(
    ray
      .intersectObjects(loaded.scene.children, true)
      .some((hit) => hit.object.name.startsWith("w3")),
  ).toBe(false);
});
test("multi-page PDFs reset calibration when a different page is selected", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Upload floor plan", { exact: true })
    .setInputFiles(path.resolve("tests/fixtures/multi-page.pdf"));
  await expect(page.getByLabel("PDF page")).toBeVisible();
  await page.getByLabel("PDF page").selectOption("2");
  await expect(page.getByRole("status")).toContainText("Click two points");
  expect((await exportProject(page)).source.page).toBe(2);
  await expect(
    page.getByRole("button", { name: "Generate AI draft" }),
  ).toBeDisabled();
});
test("concept generation/editing uses separate image output and keeps geometry intact", async ({
  page,
}) => {
  await simulate(page);
  const image = fixtures[0].source.dataUrl;
  let calls = 0;
  await page.route("**/api/concept-image", async (route) => {
    calls++;
    expect(route.request().postDataJSON().image).toMatch(
      /^data:image\/png;base64,/,
    );
    await route.fulfill({ json: { image } });
  });
  await page.goto("/");
  await expect(page.getByTestId("scene").locator("canvas")).toBeVisible();
  const before = (await exportProject(page)).model;
  await page
    .getByRole("button", { name: "Generate concept image", exact: true })
    .click();
  await expect(
    page.getByAltText("Generated architectural concept illustration"),
  ).toBeVisible();
  await page.getByLabel("Concept image prompt").fill("Change finishes to oak");
  await page
    .getByRole("button", { name: "Edit concept image", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Concept image ready");
  expect(calls).toBe(2);
  expect((await exportProject(page)).model).toEqual(before);
});
test("missing credentials, invalid upload and malformed project preserve the accepted model", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("AI edit command")
    .fill("Move the north wall right by 300 mm");
  await page.getByRole("button", { name: "Preview AI edit" }).click();
  await expect(page.getByRole("alert")).toContainText(".env");
  await page
    .getByLabel("Upload floor plan", { exact: true })
    .setInputFiles({
      name: "invalid.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("bad"),
    });
  await expect(page.getByRole("alert")).toContainText("PNG");
  await page
    .getByLabel("Import project JSON")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await exportProject(page)).model.walls).toHaveLength(6);
});
test("draft issues can be corrected and discarded without corrupting the accepted project", async ({
  page,
}) => {
  await simulate(page);
  await page.route("**/api/extract-plan", async (route) => {
    const body = route.request().postDataJSON(),
      model = structuredClone(fixtures[0].model);
    model.openings[0].offset = 99999;
    await route.fulfill({
      json: {
        model: { ...model, revision: body.revision },
        notes: ["Opening needs correction."],
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Import project JSON")
    .setInputFiles({
      name: "calibrated.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          model: fixtures[0].model,
          source: fixtures[0].source,
        }),
      ),
    });
  await expect(page.getByRole("status")).toContainText("imported");
  await page.getByRole("button", { name: "Generate AI draft" }).click();
  await expect(
    page.getByRole("button", { name: "Accept reviewed draft" }),
  ).toBeDisabled();
  await page.getByLabel("Select element").selectOption("window-1");
  await page.getByLabel("Wall offset").fill("2000");
  await page.getByLabel("Wall offset").press("Enter");
  await expect(
    page.getByRole("button", { name: "Accept reviewed draft" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Discard draft" }).click();
  expect((await exportProject(page)).model.openings[0].offset).toBe(
    fixtures[0].model.openings[0].offset,
  );
});
test("mobile workspace remains usable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByLabel("Upload floor plan", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
