import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("external module bridge artifacts", () => {
  const jsxRuntimePath = resolve(
    __dirname,
    "../../../out/renderer/assets/external-react-jsx-runtime.js"
  );
  const reactDomClientPath = resolve(
    __dirname,
    "../../../out/renderer/assets/external-react-dom-client.js"
  );

  const canReadBuildArtifacts = (() => {
    try {
      readFileSync(jsxRuntimePath, "utf8");
      readFileSync(reactDomClientPath, "utf8");
      return true;
    } catch {
      return false;
    }
  })();

  const runIfBuilt = canReadBuildArtifacts ? it : it.skip;

  runIfBuilt("exports jsx runtime named symbols", () => {
    const source = readFileSync(
      jsxRuntimePath,
      "utf8"
    );

    expect(source).toContain("jsx");
    expect(source).toContain("jsxs");
    expect(source).toContain("Fragment");
    expect(source).toContain("export {");
  });

  runIfBuilt("exports react-dom client named symbols", () => {
    const source = readFileSync(
      reactDomClientPath,
      "utf8"
    );

    expect(source).toContain("createRoot");
    expect(source).toContain("hydrateRoot");
    expect(source).toContain("export {");
  });
});
