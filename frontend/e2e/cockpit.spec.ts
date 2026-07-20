import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const sceneNames = [
  "城市路口侧向超车",
  "工区左转跟车",
  "人车混流待转",
  "斑马线母婴穿越",
  "停车场行人横穿",
  "繁忙路口公交博弈",
  "停车区人车密集",
  "夜间主干道施工",
  "雨夜行人横穿",
  "低照路口混行",
] as const;

const screenshotRoot = path.resolve(process.cwd(), "../.run/playwright/screenshots");

async function openCockpit(page: Page) {
  await page.goto("/");
  const entry = page.getByRole("button", { name: /进入效果展示/ });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole("region", { name: "场景入口" })).toBeInViewport();
  await expect(page.locator("video")).toHaveCount(3);
  await expect(page.getByTestId("cockpit-scene-video-entry")).toHaveJSProperty("readyState", 4);
}

async function openDemoFromNavigation(page: Page) {
  await page.goto("/");
  const stage = page.getByTestId("view-transition-stage");
  const showcaseEntry = page.getByRole("button", { name: /进入效果展示/ });
  await expect(showcaseEntry).toBeVisible();
  await showcaseEntry.click();
  await expect(stage).toHaveAttribute("data-view-transition-phase", "cockpit", { timeout: 5_000 });
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-view-transition-phase", "site", { timeout: 5_000 });

  const demoLink = page.getByRole("link", { name: "效果展示", exact: true });
  await expect(demoLink).toBeVisible();
  await demoLink.click({ noWaitAfter: true });

  const showcase = page.locator(".showcase");
  await expect(page.locator("#demo")).toBeInViewport();
  return showcase;
}

function videoForScreen(page: Page, screen: "entry" | "live" | "diagnosis") {
  return page.getByTestId(`cockpit-scene-video-${screen}`);
}

function activeVideo(page: Page) {
  return page.locator('.persistent-player[data-active="true"] video');
}

async function regionInViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  return Boolean(box && viewport && box.y < viewport.height && box.y + box.height > 0);
}

async function navigateByWheel(page: Page, screen: "live" | "diagnosis") {
  const root = page.locator(".cockpit-experience");
  const targetRegion = page.getByRole("region", { name: screen === "live" ? "实时解析" : "全域诊断" });
  const order = ["entry", "live", "diagnosis"];
  await expect.poll(async () => {
    const current = await root.getAttribute("data-active-screen");
    if (current === screen || await regionInViewport(page, targetRegion)) return screen;
    const direction = order.indexOf(screen) > order.indexOf(current ?? "entry") ? 1 : -1;
    await root.hover({ position: { x: 24, y: 200 } });
    await page.mouse.wheel(0, direction * 900);
    await page.waitForTimeout(250);
    return root.getAttribute("data-active-screen");
  }, { timeout: 60_000 }).toBe(screen);
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
  ).__sceneResetTime), { timeout: 60_000 }).toBeLessThan(0.5);
}

async function switchSceneAndExpectPlayback(
  page: Page,
  name: string,
  expectedSrc: string,
  activeScreen: "live" | "diagnosis",
) {
  const root = page.locator(".cockpit-experience");
  const video = activeVideo(page);
  const beforeScroll = await root.evaluate((node) => node.scrollTop);
  await video.evaluate((node: HTMLVideoElement) => { node.playbackRate = 0.125; });
  await armSceneResetProbe(video);
  await selectScene(page, name);
  await expect(video).toHaveAttribute("src", expectedSrc);
  await expectSceneResetNearZero(video);
  await expect.poll(
    () => video.evaluate((node: HTMLVideoElement) => node.readyState),
    { timeout: 60_000 },
  ).toBeGreaterThanOrEqual(3);
  const media = await video.evaluate((node: HTMLVideoElement) => ({ paused: node.paused }));
  await expect(page.locator("video")).toHaveCount(3);
  expect(media.paused).toBe(false);
  await expect(root).toHaveAttribute("data-active-screen", activeScreen);
  expect(Math.abs(await root.evaluate((node) => node.scrollTop) - beforeScroll)).toBeLessThan(2);
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

async function expectInside(parent: Locator, children: Locator[]) {
  const parentBox = await parent.boundingBox();
  expect(parentBox).not.toBeNull();
  const boxes = await Promise.all(children.map((child) => child.boundingBox()));
  boxes.forEach((box) => {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(parentBox!.x - 1);
    expect(box!.y).toBeGreaterThanOrEqual(parentBox!.y - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(parentBox!.x + parentBox!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(parentBox!.y + parentBox!.height + 1);
  });
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index]!.y).toBeGreaterThanOrEqual(boxes[index - 1]!.y + boxes[index - 1]!.height - 1);
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

test("opens the cockpit with a horizontal full-screen transition and restores the showcase", async ({ page }) => {
  test.setTimeout(180_000);
  const showcase = await openDemoFromNavigation(page);
  const stage = page.getByTestId("view-transition-stage");
  const entry = page.getByRole("button", { name: "进入驾驶舱", exact: true });

  await expect(entry).toHaveCount(1);
  await expect(entry).toBeVisible();
  await expect(page.getByText("DRIVEGUARD / LIVE DEMO")).toHaveCount(0);
  await expect(page.getByText("nuScenes mini · 前视视频 · 激光雷达")).toHaveCount(0);
  await expect(page.locator(".demo-metrics")).toHaveCount(0);
  await expect(page.locator(".mini-map")).toHaveCount(0);
  await expect(page.getByText("打开后可查看感知框、原始点云、地图轨迹、全域诊断和历史风险事件回放。")).toHaveCount(0);

  await entry.scrollIntoViewIfNeeded();
  let previousScroll: number | null = null;
  let stablePolls = 0;
  await expect.poll(async () => {
    const currentScroll = await showcase.evaluate((node) => node.scrollTop);
    stablePolls = previousScroll !== null && Math.abs(currentScroll - previousScroll) < 0.5
      ? stablePolls + 1
      : 0;
    previousScroll = currentScroll;
    return stablePolls;
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const beforeScroll = await showcase.evaluate((node) => node.scrollTop);
  await entry.click();
  await expect(stage).toHaveAttribute("data-view-transition-phase", "cockpit", { timeout: 5_000 });
  await expect(page.getByTestId("view-layer-cockpit")).toBeInViewport();

  const cockpit = page.locator(".cockpit-experience");
  await expect(cockpit).toBeVisible();
  const viewport = page.viewportSize();
  const cockpitBox = await cockpit.boundingBox();
  expect(cockpitBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(cockpitBox!.width).toBeCloseTo(viewport!.width, 0);
  expect(cockpitBox!.height).toBeCloseTo(viewport!.height, 0);

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-view-transition-phase", "site", { timeout: 5_000 });
  await page.waitForFunction((scrollTop) => {
    const current = document.querySelector<HTMLElement>(".showcase")?.scrollTop ?? 0;
    return current > 0 && Math.abs(current - scrollTop) < 2;
  }, beforeScroll);
  expect(Math.abs(await showcase.evaluate((node) => node.scrollTop) - beforeScroll)).toBeLessThan(2);
});

test("keeps one continuous video across all three screens", async ({ page }) => {
  await openCockpit(page);
  const entryVideo = videoForScreen(page, "entry");
  await entryVideo.evaluate((node: HTMLVideoElement) => {
    node.currentTime = 2;
    node.playbackRate = 0.0625;
    return node.play();
  });
  await expect.poll(() => entryVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(2.05);
  const before = await entryVideo.evaluate((node: HTMLVideoElement) => ({
    time: node.currentTime,
    paused: node.paused,
    duration: node.duration,
    rate: node.playbackRate,
  }));

  const transitionStartedAt = performance.now();
  await navigateByWheel(page, "live");
  await expect(page.getByRole("region", { name: "实时解析" })).toBeInViewport();
  await expect(page.locator("video")).toHaveCount(3);
  const liveVideo = videoForScreen(page, "live");
  const live = await liveVideo.evaluate((node: HTMLVideoElement) => ({ time: node.currentTime, paused: node.paused, rate: node.playbackRate }));
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

  await liveVideo.evaluate((node: HTMLVideoElement) => {
    node.currentTime = 3;
    node.pause();
    node.playbackRate = 1.5;
  });
  await expect.poll(() => liveVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(3, 1);
  const paused = await liveVideo.evaluate((node: HTMLVideoElement) => ({ time: node.currentTime, paused: node.paused }));

  await navigateByWheel(page, "diagnosis");
  await expect(page.getByRole("region", { name: "全域诊断" })).toBeInViewport();
  await expect(page.locator("video")).toHaveCount(3);
  const diagnosisVideo = videoForScreen(page, "diagnosis");
  const diagnosis = await diagnosisVideo.evaluate((node: HTMLVideoElement) => ({ time: node.currentTime, paused: node.paused, rate: node.playbackRate }));
  expect(diagnosis.time).toBeCloseTo(paused.time, 1);
  expect(diagnosis.paused).toBe(true);
  expect(diagnosis.rate).toBe(1.5);
});

test("switches ten Chinese scenes in place and keeps live and diagnosis screens stable", async ({ page }) => {
  test.setTimeout(900_000);
  await openCockpit(page);
  const root = page.locator(".cockpit-experience");
  const video = videoForScreen(page, "entry");
  const entryScroll = await root.evaluate((node) => node.scrollTop);
  await video.evaluate((node: HTMLVideoElement) => { node.playbackRate = 0.125; });
  const oldPoster = await video.screenshot();
  await armSceneResetProbe(video);
  await page.getByRole("button", { name: "工区左转跟车", exact: true }).click();
  await expect(video).toHaveAttribute("src", "/scenes/scene-0061/sample.mp4");
  await expectSceneResetNearZero(video);
  await expect.poll(
    () => video.evaluate((node: HTMLVideoElement) => node.readyState),
    { timeout: 60_000 },
  ).toBeGreaterThanOrEqual(3);
  await expect(page.locator("video")).toHaveCount(3);
  expect(await root.evaluate((node) => node.scrollTop)).toBe(entryScroll);
  const entryMedia = await video.evaluate((node: HTMLVideoElement) => ({ paused: node.paused }));
  expect(entryMedia.paused).toBe(false);
  expect((await video.screenshot()).equals(oldPoster)).toBe(false);

  const optionLabels = await page.getByRole("combobox", { name: "选择数据场景" }).locator("option").allTextContents();
  expect(optionLabels).toEqual(sceneNames);
  expect(await page.locator("body").innerText()).not.toMatch(/scene-\d{4}/i);

  await navigateByWheel(page, "live");
  await switchSceneAndExpectPlayback(page, "人车混流待转", "/scenes/scene-0103/sample.mp4", "live");
  await navigateByWheel(page, "diagnosis");
  await expect(page.getByRole("combobox", { name: "选择数据场景" })).not.toBeAttached();
  await expect(page.getByRole("button", { name: "生成全场景报告" })).not.toBeAttached();
  await expect(page.locator('.cockpit-diagnosis__action[aria-label="诊断任务"]')).toContainText("驾驶诊断");
});

test("keeps LiDAR ownership and readiness across every manifest scene", async ({ page }) => {
  test.setTimeout(900_000);
  await openCockpit(page);
  await navigateByWheel(page, "live");
  const sceneSelect = page.getByRole("combobox", { name: "选择数据场景" });
  const sceneIds = await sceneSelect.locator("option").evaluateAll((options) => (
    options.map((option) => (option as HTMLOptionElement).value)
  ));

  for (const sceneId of sceneIds) {
    await sceneSelect.selectOption(sceneId);
    await expect(sceneSelect).toHaveValue(sceneId);
    await expect(videoForScreen(page, "live")).toHaveJSProperty("readyState", 4, { timeout: 60_000 });
    await expect(page.locator(`.lidar-bev-shell[data-scene-id="${sceneId}"]`)).toBeVisible();
    await expect(page.locator(".lidar-bev-state")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator(".lidar-bev-stale-warning")).toHaveCount(0);
  }
});

test("keeps health and realtime evidence visible without diagnosis-only controls", async ({ page, request }) => {
  const health = await request.get("http://127.0.0.1:8080/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ status: "ok" });

  await openCockpit(page);
  await navigateByWheel(page, "live");
  await expect(page.getByTestId("lidar-webgl-canvas")).toBeVisible();
  await expect(page.getByLabel("可缩放和平移的局部地图")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "实时监测" })).toBeVisible();
  await expect(page.locator(".cockpit-monitor__history .diagnosis-history-panel")).toContainText("历史风险事件");

  await navigateByWheel(page, "diagnosis");
  await expect(page.locator('.cockpit-diagnosis__action[aria-label="诊断任务"]')).toContainText("驾驶诊断");
  await expect(page.getByRole("combobox", { name: "选择数据场景" })).not.toBeAttached();
  await expect(page.getByRole("button", { name: "全域诊断", exact: true })).not.toBeAttached();
  await expect(page.getByRole("button", { name: "生成全场景报告" })).not.toBeAttached();
  expect(await page.locator("body").innerText()).not.toMatch(/scene-\d{4}/i);
});

test("passes desktop visual, pixel, and overlap QA at all required viewports", async ({ browser }) => {
  test.setTimeout(2_400_000);
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
    const entryPlayer = page.getByTestId("persistent-scene-player-entry");
    await expectContained(entryPlayer, viewport);
    await expect(entryPlayer).toHaveCSS("position", "relative");
    await page.screenshot({ path: path.join(screenshotRoot, `${slug}-entry.png`), fullPage: false });

    const terrain = page.getByTestId("terrain-backdrop-canvas");
    const terrainFirst = await screenshotSignal(terrain);
    expect(terrainFirst.colors).toBeGreaterThan(8);
    expect(terrainFirst.nonBackground).toBeGreaterThan(100);
    await expect.poll(async () => (await screenshotSignal(terrain)).checksum, {
      timeout: 20_000,
      intervals: [100, 200, 400],
    }).not.toBe(terrainFirst.checksum);

    const video = videoForScreen(page, "entry");
    const firstFrame = await videoSignal(video);
    expect(firstFrame.width).toBeGreaterThan(0);
    expect(firstFrame.height).toBeGreaterThan(0);
    expect(firstFrame.colors).toBeGreaterThan(8);
    await expect.poll(async () => (await videoSignal(video)).checksum, {
      timeout: 20_000,
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
    const [liveLidarBox, liveMapBox] = await Promise.all([
      lidarPanel.boundingBox(), mapPanel.boundingBox(),
    ]);
    expect(liveLidarBox).not.toBeNull();
    expect(liveMapBox).not.toBeNull();
    expect(Math.abs(liveLidarBox!.x - liveMapBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(liveLidarBox!.width - liveMapBox!.width)).toBeLessThanOrEqual(1);
    expect(liveMapBox!.y).toBeGreaterThanOrEqual(
      liveLidarBox!.y + liveLidarBox!.height - 1,
    );
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
    const diagnosisPersistentEvidence = diagnosisEvidence.locator(
      ":scope > .cockpit-persistent-evidence-slot > .cockpit-persistent-evidence-layer",
    );
    const diagnosisLidar = diagnosisPersistentEvidence.locator(":scope > .cockpit-evidence-panel").nth(0);
    const diagnosisMap = diagnosisPersistentEvidence.locator(":scope > .cockpit-evidence-panel").nth(1);
    const diagnosisAction = diagnosisEvidence.locator(":scope > .cockpit-diagnosis__action");
    const diagnosisChildren = [diagnosisLidar, diagnosisMap, diagnosisAction];
    await expectDisjoint([diagnosisVideo, diagnosisEvidence]);
    await expectDisjoint(diagnosisChildren);
    await expectInside(diagnosisEvidence, diagnosisChildren);
    await expectContained(diagnosisVideo, viewport);
    await expectContained(diagnosisEvidence, viewport);
    for (const child of diagnosisChildren) await expectContained(child, viewport);
    const diagnosisLidarSignal = await screenshotSignal(diagnosisLidar.getByTestId("lidar-webgl-canvas"));
    const diagnosisMapSignal = await bitmapSignal(diagnosisMap.getByLabel("可缩放和平移的局部地图"));
    expect(diagnosisLidarSignal.width).toBeGreaterThan(0);
    expect(diagnosisLidarSignal.colors).toBeGreaterThan(2);
    expect(diagnosisMapSignal.width).toBeGreaterThan(0);
    expect(diagnosisMapSignal.colors).toBeGreaterThan(4);
    await expect(diagnosisAction).not.toBeEmpty();
    await page.screenshot({ path: path.join(screenshotRoot, `${slug}-diagnosis.png`), fullPage: false });

    expect(await page.locator("body").innerText()).not.toMatch(/scene-\d{4}/i);
    await page.close();
  }
});
