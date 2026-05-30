import { beforeEach, describe, expect, it, vi } from "vitest";

const registerContributionMock = vi.hoisted(() => vi.fn());

vi.mock("../core.queryengine.payloadbuilder/catalog-contributions", () => ({
  registerPayloadbuilderCatalogContribution: registerContributionMock
}));

import { coreQueryEnginePayloadbuilderFilesystemPlugin } from "./plugin";

describe("core.queryengine.payloadbuilder.filesystem plugin", () => {
  beforeEach(() => {
    registerContributionMock.mockReset();
  });

  it("registers filesystem catalog contribution without panel", () => {
    coreQueryEnginePayloadbuilderFilesystemPlugin.activate({} as never);

    expect(registerContributionMock).toHaveBeenCalledWith({
      catalogId: "filesystem",
      title: "Filesystem",
      defaultAlias: "fs",
      allowMultiple: false
    });
  });
});
