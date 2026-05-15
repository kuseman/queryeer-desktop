import { useEffect, useState } from "react";
import type { BackendGatewayStatus } from "../../contracts/backend";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

type MemoryData = {
  jvm?: { heapUsedBytes: number; heapMaxBytes: number };
  node?: { heapUsed: number; heapTotal: number; rss: number };
};

export function MemoryIndicator() {
  const [data, setData] = useState<MemoryData | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [backendStatus, nodeMemory] = await Promise.all([
        window.appShell.getBackendStatus().catch((): BackendGatewayStatus | null => null),
        window.appShell.getMemoryUsage().catch(() => null)
      ]);
      if (!active) return;
      const jvm = backendStatus?.jvmMemory;
      setData({
        jvm: jvm ? { heapUsedBytes: jvm.heapUsedBytes, heapMaxBytes: jvm.heapMaxBytes } : undefined,
        node: nodeMemory ? { heapUsed: nodeMemory.heapUsed, heapTotal: nodeMemory.heapTotal, rss: nodeMemory.rss } : undefined
      });
    };
    void refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (!data || (!data.jvm && !data.node)) {
    return null;
  }

  const parts: string[] = [];
  const tooltipParts: string[] = [];

  if (data.jvm) {
    parts.push(`JVM: ${formatBytes(data.jvm.heapUsedBytes)}`);
    tooltipParts.push(`JVM heap: ${formatBytes(data.jvm.heapUsedBytes)} / ${formatBytes(data.jvm.heapMaxBytes)}`);
  }
  if (data.node) {
    parts.push(`Node: ${formatBytes(data.node.heapUsed)}`);
    tooltipParts.push(`Node heap: ${formatBytes(data.node.heapUsed)} / ${formatBytes(data.node.heapTotal)}`);
    tooltipParts.push(`RSS: ${formatBytes(data.node.rss)}`);
  }

  return (
    <span title={tooltipParts.join(" | ")}>
      {parts.join("  ")}
    </span>
  );
}
