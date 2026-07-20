import { expect, test, type Page } from "@playwright/test";
import playwrightConfig from "../playwright.config";
import type { ReportV2 } from "../src/features/diagnosis/contracts";
import { reportFixture } from "../src/features/diagnosis/test-fixtures";

function fixtureId(prefix: "ev" | "ep" | "finding" | "recommendation", index: number) {
  return `${prefix}-${String(index + 1001).padStart(4, "0")}`;
}

const completedReport: ReportV2 = {
  ...reportFixture,
  meta: {
    ...reportFixture.meta,
    scene_name: "城市路口侧向超车",
    data_version: "manifest-v1",
  },
  analysis: {
    ...reportFixture.analysis,
    priority_findings: Array.from({ length: 24 }, (_, index) => ({
      id: fixtureId("finding", index),
      title: `滚动验证发现 ${index + 1}`,
      summary: "用于验证分析工作区的独立纵向滚动。",
      severity: index % 3 === 0 ? "high" : "medium",
      evidence_ids: [fixtureId("ev", 0)],
    })),
    recommendations: Array.from({ length: 12 }, (_, index) => ({
      id: fixtureId("recommendation", index),
      priority: index % 3 === 0 ? "high" : "medium",
      action: `滚动验证动作 ${index + 1}`,
      rationale: "用于验证分析工作区的独立纵向滚动。",
      evidence_ids: [fixtureId("ev", 0)],
    })),
  },
  evidence: {
    ...reportFixture.evidence,
    timeline: Array.from({ length: 18 }, (_, index) => ({
      id: fixtureId("ep", index),
      start_time: index + 1,
      end_time: index + 1.75,
      peak_time: index + 1.4,
      risk: index % 2 === 0 ? "high" : "medium",
      summary: `滚动验证风险区间 ${index + 1}`,
      evidence_ids: [fixtureId("ev", index)],
      control_conflict: false,
    })),
    index: Array.from({ length: 18 }, (_, index) => ({
      id: fixtureId("ev", index),
      source: index % 2 === 0 ? "camera" : "lidar",
      provenance: index % 2 === 0 ? "real" : "real-derived",
      start_time: index + 1,
      end_time: index + 1.75,
      detail: `滚动验证证据 ${index + 1}`,
    })),
    default_evidence_id: fixtureId("ev", 0),
  },
};

function snapshot(stage: "queued" | "evidence" | "complete" | "failed", percent: number) {
  return {
    jobId: "route-mocked-job",
    sceneKey: "default",
    dataVersion: "manifest-v1",
    stage,
    percent,
    report: stage === "complete" ? completedReport : null,
    error: stage === "failed" ? "route-mocked failure" : null,
  };
}

async function mockDiagnosis(page: Page, terminal: "complete" | "failed" = "complete") {
  let poll = 0;
  await page.route("**/api/v1/diagnoses", async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(snapshot("queued", 0)) });
  });
  await page.route("**/api/v1/diagnoses/route-mocked-job", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        ...snapshot("failed", 62),
        stage: "cancelled",
        error: null,
      }) });
      return;
    }
    poll += 1;
    const next = poll === 1 ? snapshot("evidence", 62) : snapshot(terminal, terminal === "complete" ? 100 : 62);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(next) });
  });
}

async function openCockpit(page: Page) {
  await page.goto("/");
  const entry = page.getByRole("button", { name: /进入效果展示/ });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole("region", { name: "场景入口" })).toBeInViewport();
}

async function navigateToDiagnosis(page: Page) {
  const root = page.locator(".cockpit-experience");
  await page.getByRole("region", { name: "全域诊断" }).scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute("data-active-screen", "diagnosis");
}

test("shows job progress in screen 03 then moves once to screen 04", async ({ page }) => {
  await mockDiagnosis(page);
  await openCockpit(page);
  await navigateToDiagnosis(page);
  await page.getByRole("button", { name: "启动全域诊断" }).click();

  await expect(page.getByText("正在建立诊断证据链")).toBeVisible();
  await expect(page.getByRole("region", { name: "诊断报告" })).toBeVisible();
  await expect(page.locator(".cockpit-experience")).toHaveAttribute("data-active-screen", "report");
  await expect(page.getByText("模型响应超时，已切换为本地可验证分析")).toBeVisible();
  await expect(page.getByRole("region", { name: "分析" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "证据" })).toBeVisible();

  const reportVideo = page.getByTestId("cockpit-scene-video-report");
  await reportVideo.evaluate((video: HTMLVideoElement) => video.pause());
  await reportVideo.evaluate((video: HTMLVideoElement) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    if (!descriptor?.get || !descriptor.set) throw new Error("currentTime descriptor unavailable");
    const state = window as typeof window & { __reportEvidenceSeekAssignments?: number[] };
    state.__reportEvidenceSeekAssignments = [];
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => descriptor.get!.call(video),
      set: (value: number) => {
        state.__reportEvidenceSeekAssignments?.push(value);
        descriptor.set!.call(video, value);
      },
    });
  });
  await page.getByRole("button", { name: /滚动验证风险区间 2/ }).click();
  await expect(page.locator(".report-evidence-current")).toContainText("滚动验证证据 2");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __reportEvidenceSeekAssignments?: number[] }
  ).__reportEvidenceSeekAssignments ?? [])).toContain(2);
  await page.evaluate(() => {
    (window as typeof window & { __reportEvidenceSeekAssignments?: number[] }).__reportEvidenceSeekAssignments = [];
  });
  await page.getByRole("button", { name: "返回 03" }).click();
  await expect(page.locator(".cockpit-experience")).toHaveAttribute("data-active-screen", "diagnosis");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __reportEvidenceSeekAssignments?: number[] }
  ).__reportEvidenceSeekAssignments ?? [])).toContain(2);
});

test("keeps a failed run in screen 03 and enables retry", async ({ page }) => {
  await mockDiagnosis(page, "failed");
  await openCockpit(page);
  await navigateToDiagnosis(page);
  await page.getByRole("button", { name: "启动全域诊断" }).click();

  await expect(page.getByText("诊断未完成，请重试")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新诊断" })).toBeEnabled();
  await expect(page.locator(".cockpit-experience")).toHaveAttribute("data-active-screen", "diagnosis");
  await expect(page.getByRole("region", { name: "诊断报告" })).not.toBeAttached();
});

test("scrolls overflowing report columns independently", async ({ page }) => {
  await mockDiagnosis(page);
  await openCockpit(page);
  await navigateToDiagnosis(page);
  await page.getByRole("button", { name: "启动全域诊断" }).click();
  await expect(page.getByRole("region", { name: "诊断报告" })).toBeVisible();

  const analysis = page.getByRole("region", { name: "分析" });
  const evidence = page.getByRole("complementary", { name: "证据" });
  await expect.poll(() => analysis.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect.poll(() => evidence.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const evidenceInitialTop = await evidence.evaluate((element) => element.scrollTop);
  await analysis.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => analysis.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await evidence.evaluate((element) => element.scrollTop)).toBe(evidenceInitialTop);

  const analysisTop = await analysis.evaluate((element) => element.scrollTop);
  await evidence.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => evidence.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await analysis.evaluate((element) => element.scrollTop)).toBe(analysisTop);
});

test("uses automatic report entry and return scrolling under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const calls: Array<{ screen: string | null; behavior: string | null }> = [];
    (window as typeof window & { __diagnosisReportScrollCalls?: typeof calls }).__diagnosisReportScrollCalls = calls;
    Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      const element = this as HTMLElement;
      calls.push({
        screen: element.closest<HTMLElement>("[data-cockpit-screen]")?.dataset.cockpitScreen ?? null,
        behavior: typeof options === "object" && options !== null ? options.behavior ?? null : null,
      });
    };
  });

  await mockDiagnosis(page);
  await openCockpit(page);
  await navigateToDiagnosis(page);
  await page.getByRole("button", { name: "启动全域诊断" }).click();
  await expect(page.getByRole("region", { name: "诊断报告" })).toBeVisible();

  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __diagnosisReportScrollCalls?: Array<{ screen: string | null; behavior: string | null }> }
  ).__diagnosisReportScrollCalls ?? [])).toContainEqual({ screen: "report", behavior: "auto" });

  await page.getByRole("button", { name: "返回 03" }).click();
  await expect(page.locator(".cockpit-experience")).toHaveAttribute("data-active-screen", "diagnosis");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __diagnosisReportScrollCalls?: Array<{ screen: string | null; behavior: string | null }> }
  ).__diagnosisReportScrollCalls ?? [])).toContainEqual({ screen: "diagnosis", behavior: "auto" });
});

test("ordinary E2E configuration clears provider credentials", async () => {
  const webServers = Array.isArray(playwrightConfig.webServer)
    ? playwrightConfig.webServer
    : [playwrightConfig.webServer];
  const backend = webServers.find((server) => server?.command.includes("uvicorn"));
  expect(backend?.env).toMatchObject({
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "",
  });
});
