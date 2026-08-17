import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyDereferenced } from "../../scripts/copy-dereferenced.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "queryeer-copy-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("copyDereferenced", () => {
  it("copies regular directory contents", () => {
    const root = temporaryDirectory();
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    writeFileSync(join(source, "file.txt"), "content");

    copyDereferenced(source, destination);

    expect(readFileSync(join(destination, "file.txt"), "utf8")).toBe("content");
  });

  it.runIf(process.platform !== "win32")("materializes file and directory symbolic links", () => {
    const root = temporaryDirectory();
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(join(source, "target-directory"), { recursive: true });
    writeFileSync(join(source, "target-file.txt"), "file content");
    writeFileSync(join(source, "target-directory", "nested.txt"), "nested content");
    symlinkSync("target-file.txt", join(source, "file-link"));
    symlinkSync("target-directory", join(source, "directory-link"));

    copyDereferenced(source, destination);

    expect(lstatSync(join(destination, "file-link")).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(destination, "directory-link")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(destination, "file-link"), "utf8")).toBe("file content");
    expect(readFileSync(join(destination, "directory-link", "nested.txt"), "utf8")).toBe(
      "nested content"
    );
  });
});
