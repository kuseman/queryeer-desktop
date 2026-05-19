import { beforeEach, describe, expect, it, vi } from "vitest";

const registerContributionMock = vi.hoisted(() => vi.fn());

vi.mock("../core.queryengine.payloadbuilder/catalog-contributions", () => ({
  registerPayloadbuilderCatalogContribution: registerContributionMock
}));

import { coreQueryEnginePayloadbuilderHttpPlugin } from "./plugin";

describe("core.queryengine.payloadbuilder.http plugin", () => {
  beforeEach(() => {
    registerContributionMock.mockReset();
  });

  it("registers http catalog contribution without panel", () => {
    coreQueryEnginePayloadbuilderHttpPlugin.activate({} as never);

    expect(registerContributionMock).toHaveBeenCalledWith({
      catalogId: "http",
      title: "HTTP",
      defaultAlias: "http",
      allowMultiple: false
    });
  });
});
