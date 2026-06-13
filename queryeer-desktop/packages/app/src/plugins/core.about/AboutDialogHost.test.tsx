import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AboutDialogHost } from "./AboutDialogHost.js";
import {
  openAboutDialog,
  closeAboutDialog,
  setAppMetadata,
  setDesktopChangelog,
  setBackendChangelogs,
  isAboutDialogOpen
} from "./about-service.js";

void React;

describe("AboutDialogHost", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
    closeAboutDialog();
    setDesktopChangelog(null);
    setBackendChangelogs([]);
    setAppMetadata({
      appVersion: "",
      electronVersion: "",
      chromiumVersion: "",
      nodeVersion: "",
      platform: "",
      arch: ""
    });
  });

  afterEach(async () => {
    closeAboutDialog();
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("renders nothing when closed", async () => {
    await act(async () => {
      root.render(<AboutDialogHost />);
    });
    expect(rootElement.querySelector(".about-dialog-overlay")).toBeNull();
  });

  it("renders dialog when opened", async () => {
    await act(async () => {
      setAppMetadata({
        appVersion: "1.0.0",
        electronVersion: "30.0.0",
        chromiumVersion: "124.0.0",
        nodeVersion: "20.0.0",
        platform: "win32",
        arch: "x64"
      });
      openAboutDialog();
    });
    await act(async () => {
      root.render(<AboutDialogHost />);
    });
    expect(rootElement.querySelector(".about-dialog-overlay")).toBeTruthy();
    expect(rootElement.textContent).toContain("About Queryeer");
    expect(rootElement.textContent).toContain("v1.0.0");
  });

  it("shows version info in About tab", async () => {
    await act(async () => {
      setAppMetadata({
        appVersion: "1.0.0",
        electronVersion: "30.0.0",
        chromiumVersion: "124.0.0",
        nodeVersion: "20.0.0",
        platform: "win32",
        arch: "x64"
      });
      openAboutDialog();
    });
    await act(async () => {
      root.render(<AboutDialogHost />);
    });
    expect(rootElement.textContent).toContain("win32 (x64)");
    expect(rootElement.textContent).toContain("Copyright (c) 2026 Marcus Henriksson");
  });

  it("shows Queryeer tab when desktop changelog is present", async () => {
    await act(async () => {
      setAppMetadata({
        appVersion: "1.0.0",
        electronVersion: "30.0.0",
        chromiumVersion: "124.0.0",
        nodeVersion: "20.0.0",
        platform: "win32",
        arch: "x64"
      });
      setDesktopChangelog("# Queryeer\n\n## 1.0.0");
      openAboutDialog();
    });
    await act(async () => {
      root.render(<AboutDialogHost />);
    });
    expect(rootElement.querySelector(".about-dialog-tab")).toBeTruthy();
    const tabs = rootElement.querySelectorAll(".about-dialog-tab");
    expect(tabs.length).toBeGreaterThanOrEqual(2);
  });

  it("shows plugin changelog tabs", async () => {
    await act(async () => {
      setAppMetadata({
        appVersion: "1.0.0",
        electronVersion: "30.0.0",
        chromiumVersion: "124.0.0",
        nodeVersion: "20.0.0",
        platform: "win32",
        arch: "x64"
      });
      setBackendChangelogs([
        { pluginId: "pb", pluginName: "PayloadBuilder", version: "2.0.0", changelog: "# PB\n\n## 2.0.0" }
      ]);
      openAboutDialog();
    });
    await act(async () => {
      root.render(<AboutDialogHost />);
    });
    const tabs = Array.from(rootElement.querySelectorAll(".about-dialog-tab")).map((t) => t.textContent);
    expect(tabs).toContain("PayloadBuilder");
  });

  it("closes on Escape key", async () => {
    await act(async () => {
      setAppMetadata({
        appVersion: "1.0.0",
        electronVersion: "30.0.0",
        chromiumVersion: "124.0.0",
        nodeVersion: "20.0.0",
        platform: "win32",
        arch: "x64"
      });
      openAboutDialog();
    });
    await act(async () => {
      root.render(<AboutDialogHost />);
    });
    expect(isAboutDialogOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await act(async () => {});
    expect(isAboutDialogOpen()).toBe(false);
  });

  it("closes when close button is clicked", async () => {
    await act(async () => {
      setAppMetadata({
        appVersion: "1.0.0",
        electronVersion: "30.0.0",
        chromiumVersion: "124.0.0",
        nodeVersion: "20.0.0",
        platform: "win32",
        arch: "x64"
      });
      openAboutDialog();
    });
    await act(async () => {
      root.render(<AboutDialogHost />);
    });
    expect(isAboutDialogOpen()).toBe(true);
    const closeBtn = rootElement.querySelector(".about-dialog-close");
    expect(closeBtn).toBeTruthy();
    (closeBtn as HTMLElement).click();
    await act(async () => {});
    expect(isAboutDialogOpen()).toBe(false);
  });
});
