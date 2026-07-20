/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SupportModules } from "./SupportModules";
import { reportFixture } from "./test-fixtures";

afterEach(cleanup);

it("renders the fact bundle scene overview fields in the compact details module", () => {
  const report = {
    ...reportFixture,
    support: {
      ...reportFixture.support,
      scene_overview: {
        description: "城市路口侧向超车场景",
        duration_seconds: 12.5,
        telemetry_samples: 240,
        perception_samples: 120,
        lidar_available: true,
      },
    },
  };
  render(<SupportModules report={report} />);

  const overview = screen.getByText("场景概览").closest("details")!;
  fireEvent.click(within(overview).getByText("场景概览"));
  expect(within(overview).getByText("场景说明")).toBeVisible();
  expect(within(overview).getByText("城市路口侧向超车场景")).toBeVisible();
  expect(within(overview).getByText("场景时长")).toBeVisible();
  expect(within(overview).getByText("12.50 秒")).toBeVisible();
  expect(within(overview).getByText("遥测样本")).toBeVisible();
  expect(within(overview).getByText("240")).toBeVisible();
  expect(within(overview).getByText("感知样本")).toBeVisible();
  expect(within(overview).getByText("120")).toBeVisible();
  expect(within(overview).getByText("激光雷达")).toBeVisible();
  expect(within(overview).getByText("是")).toBeVisible();
});
