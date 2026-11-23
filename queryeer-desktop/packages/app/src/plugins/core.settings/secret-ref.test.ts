import { describe, expect, it, vi } from "vitest";
import { copySecretRefs } from "./secret-ref";

describe("copySecretRefs", () => {
  it("gives every secretRef, also nested and in arrays, its own copy and keeps everything else", async () => {
    let next = 0;
    const copy = vi.fn(async (secretRef: string) => `${secretRef}-copy-${++next}`);
    const created = new Date(0);
    const source = {
      id: "a",
      port: 9092,
      enabled: true,
      title: null,
      created,
      password: { secretRef: "pw" },
      nested: { jaas: { secretRef: "jaas", note: "kept" } },
      variables: [{ key: "A", secretRef: { secretRef: "var" } }, { key: "B", value: "plain" }],
      // The same ref twice still gets two copies: the clone mustn't share within itself either
      again: { secretRef: "pw" }
    };

    const copied = await copySecretRefs(source, copy);

    expect(copied).toEqual({
      id: "a",
      port: 9092,
      enabled: true,
      title: null,
      created,
      password: { secretRef: expect.stringMatching(/^pw-copy-/) },
      nested: { jaas: { secretRef: expect.stringMatching(/^jaas-copy-/), note: "kept" } },
      variables: [{ key: "A", secretRef: { secretRef: expect.stringMatching(/^var-copy-/) } }, { key: "B", value: "plain" }],
      again: { secretRef: expect.stringMatching(/^pw-copy-/) }
    });
    expect(copied.password.secretRef).not.toBe(copied.again.secretRef);
    expect(copy).toHaveBeenCalledTimes(4);
    expect(copied.created).toBe(created);
    // The source is untouched
    expect(source.password).toEqual({ secretRef: "pw" });
    expect(source.variables[0]).toEqual({ key: "A", secretRef: { secretRef: "var" } });
  });

  it("leaves out a secret that can't be copied rather than sharing it", async () => {
    const copied = await copySecretRefs(
      { unknown: { secretRef: "unknown" }, failing: { secretRef: "failing" }, empty: { secretRef: "" } },
      async (secretRef) => {
        if (secretRef === "failing") {
          throw new Error("no vault");
        }
        return undefined;
      }
    );

    expect(copied).toEqual({ unknown: undefined, failing: undefined, empty: undefined });
  });

  it("copies a top-level secret and passes other values through", async () => {
    await expect(copySecretRefs({ secretRef: "pw" }, async () => "new")).resolves.toEqual({ secretRef: "new" });
    await expect(copySecretRefs("text", async () => "new")).resolves.toBe("text");
    await expect(copySecretRefs(undefined, async () => "new")).resolves.toBeUndefined();
  });
});
