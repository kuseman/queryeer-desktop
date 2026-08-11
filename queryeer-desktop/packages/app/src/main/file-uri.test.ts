import { describe, expect, it } from "vitest";
import { fileUriToPath, pathToFileUri } from "@queryeer/api/files/Resolvers";

describe("file URI conversion", () => {
  it.each([
    ["file:///Users/alice/My%20Database.sqlite", "/Users/alice/My Database.sqlite"],
    ["file:///C:/Users/alice/My%20Database.sqlite", "C:\\Users\\alice\\My Database.sqlite"],
    ["file://server/share/My%20Database.sqlite", "\\\\server\\share\\My Database.sqlite"]
  ])("converts %s to a filesystem path", (uri, expected) => {
    expect(fileUriToPath(uri)).toBe(expected);
  });

  it.each([
    ["/Users/alice/My Database#1.sqlite", "file:///Users/alice/My%20Database%231.sqlite"],
    ["C:\\Users\\alice\\My Database#1.sqlite", "file:///C:/Users/alice/My%20Database%231.sqlite"],
    ["\\\\server\\share\\My Database#1.sqlite", "file://server/share/My%20Database%231.sqlite"]
  ])("converts %s to a canonical file URI", (filePath, expected) => {
    expect(pathToFileUri(filePath)).toBe(expected);
  });
});
