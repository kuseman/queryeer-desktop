import { useEffect, useState } from "react";
import type { BackendGatewayStatus } from "../../contracts/backend";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

type MemoryData = {
  jvm?: { heapUsedBytes: number; heapMaxBytes: number };
  renderer?: { heapUsed: number; heapTotal: number };
};

function readRendererMemory(): { heapUsed: number; heapTotal: number } | null {
  const m = (performance as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  if (m) {
    return { heapUsed: m.usedJSHeapSize, heapTotal: m.totalJSHeapSize };
  }
  return null;
}

export function MemoryIndicator() {
  const [data, setData] = useState<MemoryData | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [backendStatus] = await Promise.all([
        window.appShell.getBackendStatus().catch((): BackendGatewayStatus | null => null)
      ]);
      if (!active) return;
      const jvm = backendStatus?.jvmMemory;
      const rendererMem = readRendererMemory();
      setData({
        jvm: jvm ? { heapUsedBytes: jvm.heapUsedBytes, heapMaxBytes: jvm.heapMaxBytes } : undefined,
        renderer: rendererMem ?? undefined
      });
    };
    void refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (!data || (!data.jvm && !data.renderer)) {
    return null;
  }

  const parts: string[] = [];
  const tooltipParts: string[] = [];

  if (data.jvm) {
    parts.push(`JVM: ${formatBytes(data.jvm.heapUsedBytes)}`);
    tooltipParts.push(`JVM heap: ${formatBytes(data.jvm.heapUsedBytes)} / ${formatBytes(data.jvm.heapMaxBytes)}`);
  }
  if (data.renderer) {
    parts.push(`Renderer: ${formatBytes(data.renderer.heapUsed)}`);
    tooltipParts.push(`Renderer heap: ${formatBytes(data.renderer.heapUsed)} / ${formatBytes(data.renderer.heapTotal)}`);
  }

  return (
    <span title={tooltipParts.join(" | ")}>
      {parts.join("  ")}
    </span>
  );
}
