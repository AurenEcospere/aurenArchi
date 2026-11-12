import fs from "node:fs/promises";
import path from "node:path";
await fs.mkdir("reports/screenshots", { recursive: true });
async function read(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}
const unit = await read("reports/unit.json"),
  browser = await read("reports/browser.json"),
  live = await read("reports/live.json");
type Row = { name: string; status: string; detail: string; links: string[] };
const rows: Row[] = [];
for (const suite of unit?.testResults ?? [])
  for (const test of suite.assertionResults ?? [])
    rows.push({
      name: test.fullName,
      status: test.status,
      detail: "Deterministic unit/API test",
      links: [],
    });
async function visit(suites: any[]) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      const result = spec.tests?.[0]?.results?.at(-1);
      const links: string[] = [];
      for (const [i, a] of (result?.attachments ?? []).entries())
        if (a.contentType === "image/png" && (a.path || a.body)) {
          const name = (spec.id ?? "test") + "-" + i + ".png";
          try {
            if (a.path) await fs.copyFile(a.path, "reports/screenshots/" + name);
            else await fs.writeFile("reports/screenshots/" + name, Buffer.from(a.body, "base64"));
            links.push("screenshots/" + name);
          } catch {}
        }
      rows.push({
        name: spec.title,
        status: result?.status ?? "pending",
        detail: spec.title.includes("simulated")
          ? "Simulated AI; checks workflow, not recognition accuracy"
          : "Browser behavior / exports",
        links,
      });
    }
    await visit(suite.suites ?? []);
  }
}
await visit(browser?.suites ?? []);
for (const test of live?.results ?? []) {
  const evidence = test.details ?? {};
  const links = [
    evidence.geometryReport,
    evidence.rawDraft,
    ...(evidence.images ?? []),
    ...(evidence.screenshots ?? []),
  ].filter(
    (link: unknown): link is string =>
      typeof link === "string" && link.startsWith("live/"),
  );
  rows.push({
    name: test.name,
    status: test.status,
    detail: JSON.stringify(test.details),
    links,
  });
}
const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const passed = rows.filter((r) => r.status === "passed").length,
  failed = rows.filter((r) =>
    ["failed", "timedOut", "interrupted"].includes(r.status),
  ).length,
  review = rows.filter((r) => r.status === "needs-review").length;
const html =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Auren Arch test report</title><style>body{font:14px system-ui;background:#f5f7ef;color:#234537;margin:40px auto;max-width:1200px;padding:0 20px}h1{font-size:30px}section{background:white;border:1px solid #dce5d6;border-radius:12px;padding:20px;margin:20px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #e2e8dc;font-size:12px;vertical-align:top}td:first-child{width:40%}.passed{color:#257241}.failed,.timedOut{color:#aa3e2d}.needs-review{color:#a1751a}input{padding:10px;width:100%;box-sizing:border-box}a{color:#317549}.detail{max-width:450px;overflow-wrap:anywhere}small{color:#7f9078}</style></head><body><h1>Auren Arch · test report</h1><p>' +
  passed +
  " passed · " +
  failed +
  " failed · " +
  review +
  " need review · " +
  rows.length +
  " executed checks</p><section><strong>Live OpenAI testing: " +
  (live ? "results available" : "PENDING CREDENTIALS") +
  '</strong><p>Simulated API tests establish application behavior. They do not establish real drawing recognition, model access, or image quality. Raw extraction and corrected geometry are reported separately.</p><p>Dataset: six floor-plan families × PNG/JPEG/PDF, six degraded cases, one multi-page PDF, and 30 seeded geometry layouts.</p><p>Wall matching tolerance: 100 mm at both endpoints; opening centre tolerance: 150 mm on a matched host. These recognition metrics are separate from the 1 mm deterministic dimension preservation checks.</p></section><section><input id="filter" placeholder="Filter test cases" aria-label="Filter test cases"/><table><thead><tr><th>Case</th><th>Status</th><th>Evidence</th></tr></thead><tbody>' +
  rows
    .map(
      (r) =>
        "<tr><td>" +
        escape(r.name) +
        '</td><td class="' +
        escape(r.status) +
        '">' +
        escape(r.status.toUpperCase()) +
        '</td><td class="detail">' +
        escape(r.detail) +
        " " +
        r.links
          .map((link) => '<a href="' + escape(link) + '">Evidence</a>')
          .join(" · ") +
        "</td></tr>",
    )
    .join("") +
  '</tbody></table></section><small>Local development report. Credentials are excluded.</small><script>document.getElementById("filter").addEventListener("input",function(){for(const row of document.querySelectorAll("tbody tr"))row.hidden=!row.textContent.toLowerCase().includes(this.value.toLowerCase());});</script></body></html>';
await fs.writeFile("reports/index.html", html);
console.log("Report: " + path.resolve("reports/index.html"));
