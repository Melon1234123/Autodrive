import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const sceneNames = [
  "工区左转跟车",
  "人车混流待转",
  "斑马线母婴穿越",
  "停车场行人横穿",
  "繁忙路口公交博弈",
  "城市路口侧向超车",
  "停车区人车密集",
  "夜间主干道施工",
  "雨夜行人横穿",
  "低照路口混行",
] as const;

const reportSections = [
  "执行摘要", "场景概览", "数据质量", "风险评分", "关键发现", "风险时间线",
  "感知分析", "运动与控制分析", "轨迹分析", "因果链", "优化建议", "回归测试", "证据索引", "分析限制",
] as const;

const screenshotRoot = path.resolve(process.cwd(), "../.run/playwright/screenshots");

async function openCockpit(page: Page) {
  await page.goto("/");
  const entry = page.getByRole("button", { name: /进入效果展示/ });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole("region", { name: "场景入口" })).toBeInViewport();
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.getByTestId("persistent-scene-video")).toHaveJSProperty("readyState", 4);
}

async function navigateByWheel(page: Page, screen: "live" | "diagnosis") {
  const root = page.locator(".cockpit-experience");
  await root.hover({ position: { x: 24, y: 200 } });
  await page.mouse.wheel(0, 900);
  await expect(root).toHaveAttribute("data-active-screen", screen);
  await page.waitForTimeout(180);
}

async function selectScene(page: Page, name: string) {
  const select = page.getByRole("combobox", { name: "选择数据场景" });
  await expect(select).toBeEnabled();
  const value = await select.locator("option").filter({ hasText: name }).getAttribute("value");
  expect(value).not.toBeNull();
  await select.selectOption({ label: name });
  await expect(select).toHaveValue(value!);
}

async function armSceneResetProbe(video: Locator) {
  await video.evaluate((node: HTMLVideoElement) => {
    const state = window as typeof window & { __sceneResetTime?: number };
    delete state.__sceneResetTime;
    node.addEventListener("loadstart", () => { state.__sceneResetTime = node.currentTime; }, { once: true });
  });
}

async function expectSceneResetNearZero(video: Locator) {
  await expect.poll(() => video.evaluate(() => (
    window as typeof window & { __sceneResetTime?: number }
  ).__sceneResetTime)).toBeLessThan(0.5);
}

async function switchSceneAndExpectPlayback(
  page: Page,
  name: string,
  expectedSrc: string,
  activeScreen: "live" | "diagnosis",
  originalVideo: Awaited<ReturnType<Locator["elementHandle"]>>,
) {
  const root = page.locator(".cockpit-experience");
  const video = page.getByTestId("persistent-scene-video");
  const beforeScroll = await root.evaluate((node) => node.scrollTop);
  await video.evaluate((node: HTMLVideoElement) => { node.playbackRate = 0.125; });
  await armSceneResetProbe(video);
  await selectScene(page, name);
  await expect(video).toHaveAttribute("src", expectedSrc);
  await expectSceneResetNearZero(video);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(3);
  const media = await video.evaluate((node: HTMLVideoElement) => ({ paused: node.paused }));
  await expect(page.locator("video")).toHaveCount(1);
  expect(await page.evaluate((original) => document.querySelector("video") === original, originalVideo)).toBe(true);
  expect(media.paused).toBe(false);
  await expect(root).toHaveAttribute("data-active-screen", activeScreen);
  expect(Math.abs(await root.evaluate((node) => node.scrollTop) - beforeScroll)).toBeLessThan(2);
}

async function waitForReport(page: Page) {
  const generate = page.getByRole("button", { name: "生成全场景报告" });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByLabel("诊断进度")).toContainText("已完成", { timeout: 60_000 });
  await expect(page.getByRole("article", { name: "全场景诊断报告" })).toBeVisible();
}

type LayoutBox = { x: number; y: number; width: number; height: number };

function intersectionArea(a: LayoutBox, b: LayoutBox) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

async function expectContained(locator: Locator, viewport: { width: number; height: number }) {
  const box = await locator.boundingBox();
  expect(box, `missing layout box for ${await locator.evaluate((node) => node.className)}`).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectDisjoint(locators: Locator[]) {
  const boxes = await Promise.all(locators.map((locator) => locator.boundingBox()));
  boxes.forEach((box) => expect(box).not.toBeNull());
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      expect(intersectionArea(boxes[left]!, boxes[right]!)).toBeLessThanOrEqual(1);
    }
  }
}

async function bitmapSignal(locator: Locator) {
  return locator.evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const width = element.width;
    const height = element.height;
    if (width === 0 || height === 0) return { width, height, colors: 0, nonTransparent: 0 };
    const context = element.getContext("2d");
    if (!context) return { width, height, colors: 0, nonTransparent: 0 };
    const pixels = context.getImageData(0, 0, width, height).data;
    const colors = new Set<number>();
    let nonTransparent = 0;
    const stride = Math.max(4, Math.floor(pixels.length / 20_000 / 4) * 4);
    for (let index = 0; index < pixels.length; index += stride) {
      const alpha = pixels[index + 3];
      if (alpha > 0) nonTransparent += 1;
      colors.add((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]);
    }
    return { width, height, colors: colors.size, nonTransparent };
  });
}

async function screenshotSignal(locator: Locator) {
  const dataUrl = `data:image/png;base64,${(await locator.screenshot()).toString("base64")}`;
  return locator.page().evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context?.drawImage(image, 0, 0);
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    const colors = new Map<number, number>();
    let checksum = 0;
    let sampled = 0;
    const stride = Math.max(4, Math.floor(pixels.length / 20_000 / 4) * 4);
    for (let index = 0; index < pixels.length; index += stride) {
      const color = (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2];
      colors.set(color, (colors.get(color) ?? 0) + 1);
      checksum = (checksum + color * (index + 1)) % 2_147_483_647;
      sampled += 1;
    }
    const dominant = Math.max(0, ...colors.values());
    return { width: canvas.width, height: canvas.height, colors: colors.size, nonBackground: sampled - dominant, checksum };
  }, dataUrl);
}

async function videoSignal(video: Locator) {
  return video.evaluate((node) => {
    const media = node as HTMLVideoElement;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context?.drawImage(media, 0, 0, canvas.width, canvas.height);
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    let checksum = 0;
    let colors = 0;
    const seen = new Set<number>();
    for (let index = 0; index < pixels.length; index += 4) {
      const color = (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2];
      checksum = (checksum + color * (index + 1)) % 2_147_483_647;
      seen.add(color);
    }
    colors = seen.size;
    return { checksum, colors, width: media.videoWidth, height: media.videoHeight, time: media.currentTime };
  });
}

function expectContinuousMediaProgress({
  before,
  after,
  duration,
  elapsedWallSeconds,
  playbackRate,
  transition,
}: {
  before: number;
  after: number;
  duration: number;
  elapsedWallSeconds: number;
  playbackRate: number;
  transition: string;
}) {
  const sampleTolerance = 0.08;
  const schedulingTolerance = 0.35;
  const wrapWindow = 1;
  const absoluteProgressCap = 3;
  const maxForwardDelta = Math.min(
    absoluteProgressCap,
    elapsedWallSeconds * playbackRate + schedulingTolerance,
  );
  const timeDropped = after < before - sampleTolerance;
  let forwardDelta: number;

  if (timeDropped) {
    const distanceToEnd = duration - before;
    expect(
      distanceToEnd,
      `${transition}: currentTime dropped, but playback was not within ${wrapWindow}s of the media end`,
    ).toBeLessThanOrEqual(wrapWindow);
    expect(
      after,
      `${transition}: a permitted loop wrap must land within ${wrapWindow}s of the media start`,
    ).toBeLessThanOrEqual(wrapWindow);
    forwardDelta = distanceToEnd + after;
  } else {
    expect(
      after,
      `${transition}: currentTime must not move backward or reset during a screen-only transition`,
    ).toBeGreaterThanOrEqual(before - sampleTolerance);
    forwardDelta = Math.max(0, after - before);
  }

  const progressDetails = [
    `observed=${forwardDelta.toFixed(3)}s`,
    `max=${maxForwardDelta.toFixed(3)}s`,
    `wall=${elapsedWallSeconds.toFixed(3)}s`,
    `rate=${playbackRate}`,
  ].join(", ");
  expect(forwardDelta, `${transition}: playing media must continue advancing (${progressDetails})`).toBeGreaterThan(0.02);
  expect(
    forwardDelta,
    `${transition}: media advanced beyond the wall-time playback budget (${progressDetails})`,
  ).toBeLessThanOrEqual(maxForwardDelta);
}

test("keeps one continuous video across all three screens", async ({ page }) => {
  await openCockpit(page);
  const video = page.getByTestId("persistent-scene-video");
  const handle = await video.elementHandle();
  await video.evaluate((node: HTMLVideoElement) => {
    node.currentTime = 2;
    node.playbackRate = 0.0625;
    return node.play();
  });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(2.05);
  const before = await video.evaluate((node: HTMLVideoElement) => ({
    time: node.currentTime,
    paused: node.paused,
    duration: node.duration,
    rate: node.playbackRate,
  }));

  const transitionStartedAt = performance.now();
  await navigateByWheel(page, "live");
  await expect(page.getByRole("region", { name: "实时解析" })).toBeInViewport();
  await expect(page.locator("video")).toHaveCount(1);
  expect(await page.evaluate((original) => document.querySelector("video") === original, handle)).toBe(true);
  const live = await video.evaluate((node: HTMLVideoElement) => ({ time: node.currentTime, paused: node.paused, rate: node.playbackRate }));
  const elapsedWallSeconds = (performance.now() - transitionStartedAt) / 1_000;
  expectContinuousMediaProgress({
    before: before.time,
    after: live.time,
    duration: before.duration,
    elapsedWallSeconds,
    playbackRate: before.rate,
    transition: "entry -> live",
  });
  expect(live.paused).toBe(false);
  expect(live.rate).toBe(0.0625);

  await video.evaluate((node: HTMLVideoElement) => {
    node.currentTime = 3;
    node.pause();
    node.playbackRate = 1.5;
  });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(3, 1);
  const paused = await video.evaluate((node: HTMLVideoElement) => ({ time: node.currentTime, paused: node.paused }));

  await navigateByWheel(page, "diagnosis");
  await expect(page.getByRole("region", { name: "全域诊断" })).toBeInViewport();
  await expect(page.locator("video")).toHaveCount(1);
  expect(await page.evaluate((original) => document.querySelector("video") === original, handle)).toBe(true);
  const diagnosis = await video.evaluate((node: HTMLVideoElement) => ({ time: node.currentTime, paused: node.paused, rate: node.playbackRate }));
  expect(diagnosis.time).toBeCloseTo(paused.time, 1);
  expect(diagnosis.paused).toBe(true);
  expect(diagnosis.rate).toBe(1.5);
});

test("switches ten Chinese scenes in place and keeps live and diagnosis screens stable", async ({ page }) => {
  test.setTimeout(300_000);
  await openCockpit(page);
  const root = page.locator(".cockpit-experience");
  const video = page.getByTestId("persistent-scene-video");
  const originalVideo = await video.elementHandle();
  const entryScroll = await root.evaluate((node) => node.scrollTop);
  await video.evaluate((node: HTMLVideoElement) => { node.playbackRate = 0.125; });
  const oldPoster = await video.screenshot();
  await armSceneResetProbe(video);
  await page.getByRole("button", { name: "工区左转跟车", exact: true }).click();
  await expect(video).toHaveAttribute("src", "/scenes/scene-0061/sample.mp4");
  await expectSceneResetNearZero(video);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(3);
  await expect(page.locator("video")).toHaveCount(1);
  expect(await root.evaluate((node) => node.scrollTop)).toBe(entryScroll);
  expect(await page.evaluate((original) => document.querySelector("video") === original, originalVideo)).toBe(true);
  const entryMedia = await video.evaluate((node: HTMLVideoElement) => ({ paused: node.paused }));
  expect(entryMedia.paused).toBe(false);
  expect((await video.screenshot()).equals(oldPoster)).toBe(false);

  const optionLabels = await page.getByRole("combobox", { name: "选择数据场景" }).locator("option").allTextContents();
  expect(optionLabels).toEqual(sceneNames);
  expect(await page.locator("body").innerText()).not.toMatch(/scene-\d{4}/i);

  await navigateByWheel(page, "live");
  await switchSceneAndExpectPlayback(page, "人车混流待转", "/scenes/scene-0103/sample.mp4", "live", originalVideo);
  await navigateByWheel(page, "diagnosis");
  await switchSceneAndExpectPlayback(page, "斑马线母婴穿越", "/scenes/scene-0553/sample.mp4", "diagnosis", originalVideo);
});

test("keeps health and current-frame WebSocket diagnosis while completing the full report", async ({ page, request }) => {
  test.setTimeout(300_000);
  const health = await request.get("http://127.0.0.1:8080/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ status: "ok" });

  const receivedFrames: string[] = [];
  page.on("websocket", (socket) => socket.on("framereceived", (event) => receivedFrames.push(String(event.payload))));
  await openCockpit(page);
  await navigateByWheel(page, "live");
  await expect(page.getByTestId("lidar-webgl-canvas")).toBeVisible();
  await expect(page.getByLabel("可缩放和平移的局部地图")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "实时监测" })).toBeVisible();
  await expect(page.locator(".cockpit-monitor__history .diagnosis-history-panel")).toContainText("历史风险事件");

  await navigateByWheel(page, "diagnosis");
  const frameDiagnosis = page.getByRole("button", { name: "全域诊断", exact: true });
  await expect(frameDiagnosis).toBeEnabled();
  await frameDiagnosis.click();
  await expect(frameDiagnosis).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => receivedFrames.some((frame) => frame.includes("riskLevel"))).toBe(true);

  let releasePolling = () => undefined;
  const pollingGate = new Promise<void>((resolve) => { releasePolling = resolve; });
  let pollHeld = false;
  await page.route(/\/api\/v1\/diagnoses\/[^/]+$/, async (route) => {
    pollHeld = true;
    await pollingGate;
    await route.continue();
  });
  const createdResponse = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().endsWith("/api/v1/diagnoses")
  ));
  const generate = page.getByRole("button", { name: "生成全场景报告" });
  await generate.click();
  const created = await createdResponse;
  expect(created.status()).toBe(202);
  expect(await created.json()).toMatchObject({ stage: "queued", percent: 0 });
  await expect.poll(() => pollHeld).toBe(true);
  await expect(page.getByRole("button", { name: "报告生成中" })).toBeDisabled();
  await expect(page.getByLabel("诊断进度")).toContainText("0%");
  await expect(page.locator(".cockpit-diagnosis__stage")).toContainText("等待调度");
  releasePolling();
  await expect(page.getByLabel("诊断进度")).toContainText("已完成", { timeout: 60_000 });
  const report = page.getByRole("article", { name: "全场景诊断报告" });
  await expect(report).toBeVisible();
  await expect(report.getByText("本地确定性分析", { exact: true })).toBeVisible();
  for (const section of reportSections) {
    const sectionView = report.getByRole("region", { name: section });
    await expect(sectionView).toBeAttached();
    await expect.poll(async () => (await sectionView.innerText()).replace(section, "").trim().length).toBeGreaterThan(5);
  }
  const root = page.locator(".cockpit-experience");
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeGreaterThan(900);
  await expect(root).toHaveAttribute("data-report-reading", "true");
  const reportReadingTop = await root.evaluate((node) => node.scrollTop);

  const evidence = report.locator(".diagnosis-report__evidence-actions button").first();
  const evidenceTime = Number.parseFloat((await evidence.textContent()) ?? "0");
  await page.getByTestId("persistent-scene-video").evaluate((node: HTMLVideoElement) => {
    node.playbackRate = 0.125;
  });
  await evidence.click();
  const evidencePlayback = await page.getByTestId("persistent-scene-video").evaluate((node: HTMLVideoElement) => ({
    time: node.currentTime,
    paused: node.paused,
    rate: node.playbackRate,
  }));
  expect(Math.abs(evidencePlayback.time - evidenceTime)).toBeLessThan(2);
  expect(evidencePlayback.paused).toBe(false);
  expect(evidencePlayback.rate).toBe(0.125);
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeLessThan(reportReadingTop);
  await expect(page.locator(".cockpit-diagnosis .cockpit-screen__heading")).toBeInViewport();
  expect(await page.locator("body").innerText()).not.toMatch(/scene-\d{4}/i);
});

test("passes desktop visual, pixel, and overlap QA at all required viewports", async ({ browser }) => {
  test.setTimeout(1_200_000);
  await mkdir(screenshotRoot, { recursive: true });
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]) {
    const page = await browser.newPage({ viewport });
    const slug = `${viewport.width}x${viewport.height}`;
    await openCockpit(page);
    await expectContained(page.locator(".cockpit-nav"), viewport);
    await expectContained(page.locator(".scene-rail"), viewport);
    await expectContained(page.getByTestId("persistent-scene-player"), viewport);
    await page.screenshot({ path: path.join(screenshotRoot, `${slug}-entry.png`), fullPage: false });

    const terrain = page.getByTestId("terrain-backdrop-canvas");
    const terrainFirst = await screenshotSignal(terrain);
    expect(terrainFirst.colors).toBeGreaterThan(8);
    expect(terrainFirst.nonBackground).toBeGreaterThan(100);
    await expect.poll(async () => (await screenshotSignal(terrain)).checksum, {
      timeout: 5_000,
      intervals: [100, 200, 400],
    }).not.toBe(terrainFirst.checksum);

    const video = page.getByTestId("persistent-scene-video");
    const firstFrame = await videoSignal(video);
    expect(firstFrame.width).toBeGreaterThan(0);
    expect(firstFrame.height).toBeGreaterThan(0);
    expect(firstFrame.colors).toBeGreaterThan(8);
    await expect.poll(async () => (await videoSignal(video)).checksum, {
      timeout: 5_000,
      intervals: [100, 200, 400],
    }).not.toBe(firstFrame.checksum);

    await navigateByWheel(page, "live");
    const videoFrame = page.locator(".cockpit-live .cockpit-video-frame");
    const evidence = page.locator(".cockpit-live__evidence");
    const lidarPanel = page.locator(".cockpit-live .cockpit-evidence-panel").nth(0);
    const mapPanel = page.locator(".cockpit-live .cockpit-evidence-panel").nth(1);
    const monitor = page.getByRole("complementary", { name: "实时监测" });
    await expectDisjoint([videoFrame, evidence]);
    await expectDisjoint([lidarPanel, mapPanel]);
    await expectDisjoint([page.locator(".cockpit-evidence-stack"), monitor]);
    for (const item of [videoFrame, lidarPanel, mapPanel, monitor]) await expectContained(item, viewport);
    const lidarSignal = await screenshotSignal(page.getByTestId("lidar-webgl-canvas"));
    const mapSignal = await bitmapSignal(page.getByLabel("可缩放和平移的局部地图"));
    expect(lidarSignal.width).toBeGreaterThan(0);
    expect(lidarSignal.colors).toBeGreaterThan(2);
    expect(mapSignal.colors).toBeGreaterThan(4);
    await page.screenshot({ path: path.join(screenshotRoot, `${slug}-live.png`), fullPage: false });

    await navigateByWheel(page, "diagnosis");
    const diagnosisVideo = page.locator(".cockpit-diagnosis .cockpit-video-frame");
    const diagnosisEvidence = page.locator(".cockpit-diagnosis__evidence");
    await expectDisjoint([diagnosisVideo, diagnosisEvidence]);
    await expectContained(diagnosisVideo, viewport);
    await expectContained(diagnosisEvidence, viewport);
    await page.screenshot({ path: path.join(screenshotRoot, `${slug}-diagnosis.png`), fullPage: false });

    await waitForReport(page);
    await page.screenshot({ path: path.join(screenshotRoot, `${slug}-report.png`), fullPage: false });
    await expectContained(page.locator(".diagnosis-report__header"), viewport);
    expect(await page.locator("body").innerText()).not.toMatch(/scene-\d{4}/i);
    await page.close();
  }
});
