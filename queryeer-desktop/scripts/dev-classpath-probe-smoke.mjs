import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "..");
const pluginsRoot = resolve(repoRoot, "plugins");
const probePluginRoot = resolve(pluginsRoot, "dev-classpath-probe");

function runStage() {
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npm run dev:classpath:probe:stage"], {
        cwd: desktopRoot,
        stdio: "inherit"
      })
    : spawnSync("npm", ["run", "dev:classpath:probe:stage"], {
        cwd: desktopRoot,
        stdio: "inherit"
      });

  if (result.status !== 0) {
    throw new Error("Failed to stage dev classpath probe artifacts");
  }
}

function prepareBackendRunner() {
  const args = [
    "-f",
    "queryeer-backend/pom.xml",
    "-pl",
    "backend-runner",
    "-am",
    "-DskipTests=true",
    "install"
  ];

  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `mvnw.cmd ${args.join(" ")}`], {
        cwd: repoRoot,
        stdio: "inherit"
      })
    : spawnSync(resolve(repoRoot, "mvnw"), args, {
        cwd: repoRoot,
        stdio: "inherit"
      });

  if (result.status !== 0) {
    throw new Error("Failed to prepare backend runner dependencies");
  }
}

function spawnBackend(pluginPath) {
  const args = [
    "-q",
    "-f",
    "queryeer-backend/backend-runner/pom.xml",
    `-Dqueryeer.plugins.path=${pluginPath}`,
    "-Dexec.mainClass=com.queryeer.backend.runner.BackendRunnerApp",
    "exec:java"
  ];

  return process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", `mvnw.cmd ${args.join(" ")}`], {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      })
    : spawn(resolve(repoRoot, "mvnw"), args, {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
}

async function runSmoke() {
  runStage();
  prepareBackendRunner();

  const isolatedRoot = mkdtempSync(resolve(tmpdir(), "queryeer-dev-classpath-probe-"));
  const isolatedPluginRoot = resolve(isolatedRoot, "dev-classpath-probe");
  cpSync(probePluginRoot, isolatedPluginRoot, { recursive: true });

  const backend = spawnBackend(isolatedRoot);
  const stderrLines = [];
  let stderrRemainder = "";
  const stdoutRawLines = [];
  let stdoutRawRemainder = "";
  backend.stderr.on("data", (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const combined = `${stderrRemainder}${text}`;
    const parts = combined.split(/\r?\n/);
    stderrRemainder = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line) {
        continue;
      }
      stderrLines.push(line);
      if (stderrLines.length > 80) {
        stderrLines.shift();
      }
    }
  });

  let runtimeStatusSeen = false;
  let finished = false;
  let frameBuffer = Buffer.alloc(0);

  const done = new Promise((resolvePromise, rejectPromise) => {
    backend.stdout.on("data", (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      const rawCombined = `${stdoutRawRemainder}${text}`;
      const rawParts = rawCombined.split(/\r?\n/);
      stdoutRawRemainder = rawParts.pop() ?? "";
      for (const part of rawParts) {
        const line = part.trim();
        if (!line) {
          continue;
        }
        stdoutRawLines.push(line);
        if (stdoutRawLines.length > 80) {
          stdoutRawLines.shift();
        }
      }

      frameBuffer = Buffer.concat([frameBuffer, chunk]);

      while (true) {
        const headerEnd = frameBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }

        const header = frameBuffer.subarray(0, headerEnd).toString("utf8");
        const lengthLine = header
          .split("\r\n")
          .find((line) => line.toLowerCase().startsWith("content-length:"));
        if (!lengthLine) {
          rejectPromise(new Error(`Missing Content-Length header: ${header}${formatDiagnostics(stderrLines, stderrRemainder, stdoutRawLines, stdoutRawRemainder)}`));
          return;
        }

        const contentLength = Number.parseInt(lengthLine.substring("Content-Length:".length).trim(), 10);
        if (!Number.isFinite(contentLength) || contentLength < 0) {
          rejectPromise(new Error(`Invalid Content-Length header: ${lengthLine}${formatDiagnostics(stderrLines, stderrRemainder, stdoutRawLines, stdoutRawRemainder)}`));
          return;
        }

        const frameEnd = headerEnd + 4 + contentLength;
        if (frameBuffer.length < frameEnd) {
          return;
        }

        const payload = frameBuffer.subarray(headerEnd + 4, frameEnd).toString("utf8");
        frameBuffer = frameBuffer.subarray(frameEnd);

        let envelope;
        try {
          envelope = JSON.parse(payload);
        } catch {
          continue;
        }

        if (envelope?.type !== "response") {
          continue;
        }

        if (envelope.id === "smoke-runtime-status") {
          runtimeStatusSeen = true;
          const activated = envelope?.result?.activatedPluginIds ?? [];
          if (!Array.isArray(activated) || !activated.includes("dev.classpath.probe")) {
            rejectPromise(new Error(`dev.classpath.probe was not activated in backend runtime status${formatDiagnostics(stderrLines, stderrRemainder, stdoutRawLines, stdoutRawRemainder)}`));
            return;
          }

          finished = true;
          resolvePromise();
        }
      }
    });

    backend.on("error", (error) => {
      if (!finished) {
        rejectPromise(new Error(`${error.message}${formatDiagnostics(stderrLines, stderrRemainder, stdoutRawLines, stdoutRawRemainder)}`));
      }
    });

    backend.on("exit", (code, signal) => {
      if (!finished && !runtimeStatusSeen) {
        rejectPromise(new Error(`Backend exited before runtime status response (code=${code ?? "null"}, signal=${signal ?? "null"})${formatDiagnostics(stderrLines, stderrRemainder, stdoutRawLines, stdoutRawRemainder)}`));
      }
    });
  });

  writeFrame(backend.stdin, {
    protocolVersion: "1.0.0",
    type: "request",
    id: "smoke-handshake",
    method: "backend.handshake",
    params: {
      client: { name: "queryeer-smoke", version: "0.1.0" },
      supportedProtocolMajors: [1],
      requestedCapabilities: ["backend.runtimeStatus", "health.ping"]
    }
  });
  writeFrame(backend.stdin, {
    protocolVersion: "1.0.0",
    type: "request",
    id: "smoke-runtime-status",
    method: "backend.runtimeStatus",
    params: { includeCapabilities: true }
  });

  const timeoutPromise = new Promise((_, rejectPromise) => {
    setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      backend.kill();
      rejectPromise(new Error(`Timed out waiting for backend runtime status response${formatDiagnostics(stderrLines, stderrRemainder, stdoutRawLines, stdoutRawRemainder)}`));
    }, 45000);
  });

  try {
    await Promise.race([done, timeoutPromise]);
  } finally {
    backend.kill();
    rmSync(isolatedRoot, { recursive: true, force: true });
  }

  process.stdout.write("Dev classpath probe smoke check passed\n");
}

runSmoke().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

function writeFrame(stream, envelope) {
  const payload = JSON.stringify(envelope);
  const bytes = Buffer.byteLength(payload, "utf8");
  stream.write(`Content-Length: ${bytes}\r\n\r\n${payload}`);
}

function formatDiagnostics(stderrLines, stderrRemainder, stdoutRawLines, stdoutRawRemainder) {
  const stderr = [...stderrLines];
  const tail = stderrRemainder.trim();
  if (tail) {
    stderr.push(tail);
  }

  const stdout = [...stdoutRawLines];
  const stdoutTail = stdoutRawRemainder.trim();
  if (stdoutTail) {
    stdout.push(stdoutTail);
  }

  const stderrBlock = stderr.length > 0 ? stderr.slice(-20).join("\n") : "<none captured>";
  const stdoutBlock = stdout.length > 0 ? stdout.slice(-20).join("\n") : "<none captured>";
  return `\nBackend stderr tail:\n${stderrBlock}\nBackend stdout tail:\n${stdoutBlock}`;
}
