import { afterEach, describe, expect, it } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import { findFileForModelUri, setFilesRegistry } from "./files-registry-accessor";

function registry(uris: string[]): FilesRegistry {
  const files = uris.map((uri, index) => ({ fileId: `file-${index + 1}`, uri }) as FileEntity);
  return { listFiles: () => files } as unknown as FilesRegistry;
}

afterEach(() => {
  setFilesRegistry(null as unknown as FilesRegistry);
});

describe("findFileForModelUri", () => {
  it("finds a file by the URI Monaco gives its model, which encodes more than core's file URIs", () => {
    // As core stores them: encodeURI, which leaves ( ) ' & $ , as they are
    setFilesRegistry(registry([
      "file:///C:/work/orders%20(copy).mongo",
      "file:///C:/work/a&b's$1,2.mongo",
      "untitled:q(1)",
      "file:///C:/work/100%25.sql"
    ]));

    // As Monaco's Uri.toString() gives them
    expect(findFileForModelUri("file:///c%3A/work/orders%20%28copy%29.mongo")?.fileId).toBe("file-1");
    expect(findFileForModelUri("file:///c%3A/work/a%26b%27s%241%2C2.mongo")?.fileId).toBe("file-2");
    expect(findFileForModelUri("untitled:q%281%29")?.fileId).toBe("file-3");
    expect(findFileForModelUri("file:///c%3A/work/100%25.sql")?.fileId).toBe("file-4");
    expect(findFileForModelUri("file:///c%3A/work/other.mongo")).toBeUndefined();
  });

  it("compares a URI with a stray percent sign as it is", () => {
    setFilesRegistry(registry(["untitled:50%off"]));

    expect(findFileForModelUri("untitled:50%off")?.fileId).toBe("file-1");
  });

  it("finds nothing before the files registry is set", () => {
    expect(findFileForModelUri("file:///c%3A/work/orders.mongo")).toBeUndefined();
  });
});
