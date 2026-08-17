import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationService } from "@queryeer/api/extensions/NotificationExtension";
import type { JdbcDriverStatus, RegisteredJdbcManagedDriverContribution } from "@queryeer/api/queryengine/JdbcDriverExtension";
import { JdbcDriversSettingsEditor } from "./JdbcDriversSettingsEditor";
import { getJdbcDriverManagementService } from "./jdbc-driver-management-service";

void React;

const contribution: RegisteredJdbcManagedDriverContribution = {
  ownerPluginId: "external.jdbc",
  dialectId: "external",
  displayName: "External JDBC Driver",
  groupId: "example",
  artifactId: "driver",
  driverClassName: "example.Driver",
  downloadPageUrl: "https://example.test/driver"
};

describe("JdbcDriversSettingsEditor", () => {
  let root: Root;
  let container: HTMLDivElement;
  const service = getJdbcDriverManagementService();

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const manualStatus: JdbcDriverStatus = {
      contribution,
      source: "manual",
      installedVersion: "1.0",
      latestVersion: "2.0",
      updateAvailable: true,
      restartRequired: false,
      managementAvailable: false
    };
    const notificationStub = { notify: vi.fn() } as unknown as NotificationService;
    await service.initialize({
      contributions: [contribution],
      shell: {
        listJdbcDrivers: vi.fn(async () => [manualStatus]),
        checkJdbcDrivers: vi.fn(async () => [manualStatus]),
        installJdbcDriver: vi.fn(),
        updateJdbcDriver: vi.fn(),
        removeJdbcDriver: vi.fn(),
        restoreJdbcDriver: vi.fn(),
        discardJdbcDriverRetainedSet: vi.fn(),
        restartBackendForJdbcDrivers: vi.fn()
      },
      notifications: notificationStub,
      openSettings: vi.fn(),
      confirmOperation: vi.fn(async () => true),
      updateChecksEnabled: () => false,
      persistedConnections: () => []
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    service.reset();
  });

  it("shows manual status and download action without managed actions", async () => {
    await act(async () => root.render(<JdbcDriversSettingsEditor readonly={false} />));

    expect(container.textContent).toContain("External JDBC Driver");
    expect(container.textContent).toContain("Active runtime");
    expect(container.textContent).toContain("Version 1.0");
    expect(container.textContent).toContain("manual");
    expect(container.textContent).toContain("Automatic management is unavailable");
    expect(container.textContent).toContain("Open download page");
    const buttons = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).not.toContain("Install");
    expect(buttons).not.toContain("Update");
    expect(buttons).not.toContain("Remove managed");
  });

  it("runs a companion row action with its artifact ID", async () => {
    service.reset();
    const install = vi.fn(async () => ({ accepted: true, status: {} as JdbcDriverStatus }));
    const nativeStatus: JdbcDriverStatus = {
      contribution,
      source: "missing",
      updateAvailable: false,
      restartRequired: false,
      managementAvailable: true,
      artifacts: [{
        id: "driver",
        displayName: "JDBC JAR",
        kind: "driver",
        applicable: true,
        source: "missing",
        updateAvailable: false,
        restartRequired: false,
        managementAvailable: true
      }, {
        id: "native-auth",
        displayName: "Windows Native Authentication",
        kind: "nativeLibrary",
        applicable: true,
        source: "missing",
        updateAvailable: false,
        restartRequired: false,
        managementAvailable: true
      }]
    };
    await service.initialize({
      contributions: [contribution],
      shell: {
        listJdbcDrivers: vi.fn(async () => [nativeStatus]),
        checkJdbcDrivers: vi.fn(async () => [nativeStatus]),
        installJdbcDriver: install,
        updateJdbcDriver: vi.fn(),
        removeJdbcDriver: vi.fn(),
        restoreJdbcDriver: vi.fn(),
        discardJdbcDriverRetainedSet: vi.fn(),
        restartBackendForJdbcDrivers: vi.fn()
      },
      notifications: { notify: vi.fn(() => ({ id: "notice" })) } as unknown as NotificationService,
      openSettings: vi.fn(),
      confirmOperation: vi.fn(async () => true),
      updateChecksEnabled: () => false,
      persistedConnections: () => []
    });
    await act(async () => root.render(<JdbcDriversSettingsEditor readonly={false} />));

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Install Windows Native Authentication"]');
    await act(async () => button?.click());

    expect(container.textContent).toContain("JDBC JAR");
    expect(container.textContent).toContain("Windows Native Authentication");
    expect(install).toHaveBeenCalledWith(contribution, "native-auth");
  });

  it("shows one package action for version-locked artifacts", async () => {
    service.reset();
    const install = vi.fn(async () => ({ accepted: true, status: {} as JdbcDriverStatus }));
    const packageStatus: JdbcDriverStatus = {
      contribution,
      source: "missing",
      updateAvailable: false,
      restartRequired: false,
      managementAvailable: true,
      artifacts: [{
        id: contribution.artifactId,
        displayName: "JDBC JAR",
        kind: "driver",
        applicable: true,
        source: "missing",
        updateAvailable: false,
        restartRequired: false,
        managementAvailable: true,
        managedWithPrimary: true,
        versionMismatch: true
      }, {
        id: "native-auth",
        displayName: "Windows Native Authentication",
        kind: "nativeLibrary",
        applicable: true,
        source: "missing",
        updateAvailable: false,
        restartRequired: false,
        managementAvailable: true,
        managedWithPrimary: true,
        versionMismatch: true
      }]
    };
    await service.initialize({
      contributions: [contribution],
      shell: {
        listJdbcDrivers: vi.fn(async () => [packageStatus]),
        checkJdbcDrivers: vi.fn(async () => [packageStatus]),
        installJdbcDriver: install,
        updateJdbcDriver: vi.fn(),
        removeJdbcDriver: vi.fn(),
        restoreJdbcDriver: vi.fn(),
        discardJdbcDriverRetainedSet: vi.fn(),
        restartBackendForJdbcDrivers: vi.fn()
      },
      notifications: { notify: vi.fn(() => ({ id: "notice" })) } as unknown as NotificationService,
      openSettings: vi.fn(),
      confirmOperation: vi.fn(async () => true),
      updateChecksEnabled: () => false,
      persistedConnections: () => []
    });
    await act(async () => root.render(<JdbcDriversSettingsEditor readonly={false} />));

    const packageButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Install External JDBC Driver package"]');
    await act(async () => packageButtons[0]?.click());

    expect(packageButtons).toHaveLength(1);
    expect(container.textContent).toContain("Managed with the JDBC JAR as one version-locked package.");
    expect(install).toHaveBeenCalledWith(contribution, contribution.artifactId);
  });

  it("lists disabled files and stages a restore", async () => {
    service.reset();
    const restore = vi.fn(async () => ({ accepted: true, status: {} as JdbcDriverStatus }));
    const disabledStatus: JdbcDriverStatus = {
      contribution,
      source: "manual",
      installedVersion: "2.0",
      updateAvailable: false,
      restartRequired: false,
      managementAvailable: false,
      disabledSets: [{
        id: "external-disabled-1",
        version: "1.0",
        disabledAt: "2026-08-16T10:00:00.000Z",
        reason: "Disabled because another artifact was selected for this JDBC provider.",
        pendingRestore: false,
        restorable: true,
        artifacts: [{ artifactId: contribution.artifactId, fileName: "driver-1.0.jar", source: "manual", version: "1.0" }]
      }]
    };
    const discard = vi.fn(async () => ({ accepted: true, status: { ...disabledStatus, disabledSets: undefined } }));
    await service.initialize({
      contributions: [contribution],
      shell: {
        listJdbcDrivers: vi.fn(async () => [disabledStatus]),
        checkJdbcDrivers: vi.fn(async () => [disabledStatus]),
        installJdbcDriver: vi.fn(),
        updateJdbcDriver: vi.fn(),
        removeJdbcDriver: vi.fn(),
        restoreJdbcDriver: restore,
        discardJdbcDriverRetainedSet: discard,
        restartBackendForJdbcDrivers: vi.fn()
      },
      notifications: { notify: vi.fn(() => ({ id: "notice" })) } as unknown as NotificationService,
      openSettings: vi.fn(),
      confirmOperation: vi.fn(async () => true),
      updateChecksEnabled: () => false,
      persistedConnections: () => []
    });
    await act(async () => root.render(<JdbcDriversSettingsEditor readonly={false} />));

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Activate External JDBC Driver 1.0"]');
    await act(async () => button?.click());

    expect(container.textContent).toContain("Retained versions");
    expect(container.textContent).toContain("Only one version remains active");
    expect(container.textContent).toContain("driver-1.0.jar (manual)");
    expect(restore).toHaveBeenCalledWith(contribution, "external-disabled-1");

    const discardButton = container.querySelector<HTMLButtonElement>('button[aria-label="Move External JDBC Driver 1.0 to Recycle Bin"]');
    await act(async () => discardButton?.click());
    expect(discard).toHaveBeenCalledWith(contribution, "external-disabled-1");
  });
});
