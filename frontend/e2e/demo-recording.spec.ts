import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

test("records a complete product walkthrough", async ({ page }) => {
  test.setTimeout(140_000);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "进入效果展示" })).toBeVisible();
  await page.waitForTimeout(12_000);

  await page.getByRole("button", { name: "进入效果展示" }).click();
  await expect(page.getByRole("region", { name: "场景入口" })).toBeVisible();
  await page.waitForTimeout(14_000);

  const cockpit = page.locator(".cockpit-experience");
  await cockpit.hover({ position: { x: 60, y: 480 } });
  await page.mouse.wheel(0, 1200);
  await expect(page.getByRole("region", { name: "实时解析" })).toBeInViewport();
  await page.waitForTimeout(18_000);

  await page.mouse.wheel(0, 1200);
  await expect(page.getByRole("region", { name: "全域诊断" })).toBeInViewport();
  await page.waitForTimeout(10_000);

  await page.getByRole("button", { name: "启动全域诊断" }).click();
  await expect(page.getByRole("region", { name: "诊断报告" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("当前使用本地可验证分析")).toBeVisible();
  await page.waitForTimeout(22_000);

  await page.screenshot({ path: "../docs/assets/autodrive-demo-cover.png" });
  await page.waitForTimeout(12_000);
});
