import { useEffect, useState, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  getAboutDialogState,
  closeAboutDialog,
  subscribeAboutDialog,
  getChangelogEntries
} from "./about-service.js";
import "./about-dialog.css";

type Tab = {
  id: string;
  label: string;
};

export function AboutDialogHost(): JSX.Element | null {
  const [, setVersion] = useState(0);

  useEffect(() => {
    return subscribeAboutDialog(() => {
      setVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeAboutDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const state = getAboutDialogState();
  const changelogEntries = getChangelogEntries();

  const tabs: Tab[] = useMemo(() => {
    const result: Tab[] = [
      { id: "about", label: "About" }
    ];
    if (state.desktopChangelog) {
      result.push({ id: "queryeer", label: "Queryeer" });
    }
    for (const entry of changelogEntries) {
      result.push({ id: `plugin:${entry.pluginId}`, label: entry.pluginName });
    }
    return result;
  }, [state.desktopChangelog, changelogEntries]);

  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "about");

  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? "about");
    }
  }, [tabs, activeTabId]);

  if (!state.isOpen) {
    return null;
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div
      className="about-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="About Queryeer"
    >
      <div className="about-dialog">
        <header className="about-dialog-header">
          <h2>About Queryeer</h2>
          <button
            type="button"
            className="about-dialog-close"
            onClick={() => closeAboutDialog()}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="about-dialog-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`about-dialog-tab${activeTabId === tab.id ? " active" : ""}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="about-dialog-body">
          {activeTab?.id === "about" && (
            <AboutTab state={state} />
          )}
          {activeTab?.id === "queryeer" && state.desktopChangelog && (
            <ChangelogTab
              title="Queryeer Changelog"
              changelog={state.desktopChangelog}
            />
          )}
          {activeTab?.id.startsWith("plugin:") && (
            <PluginChangelogTab pluginId={activeTab.id.replace("plugin:", "")} />
          )}
        </div>
      </div>
    </div>
  );
}

function AboutTab(props: { state: ReturnType<typeof getAboutDialogState> }): JSX.Element {
  const { state } = props;
  return (
    <div className="about-tab-content">
      <div className="about-brand">
        <h3>Queryeer</h3>
        <p className="about-version">v{state.appVersion}</p>
      </div>

      <div className="about-info-grid">
        <InfoRow label="Electron" value={state.electronVersion} />
        <InfoRow label="Chromium" value={state.chromiumVersion} />
        <InfoRow label="Node.js" value={state.nodeVersion} />
        <InfoRow label="Platform" value={`${state.platform} (${state.arch})`} />
      </div>
    </div>
  );
}

function InfoRow(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="about-info-row">
      <span className="about-info-label">{props.label}</span>
      <span className="about-info-value">{props.value}</span>
    </div>
  );
}

function ChangelogTab(props: { title: string; changelog: string }): JSX.Element {
  return (
    <div className="about-changelog-content">
      <h3>{props.title}</h3>
      <MarkdownRenderer content={props.changelog} />
    </div>
  );
}

function MarkdownRenderer(props: { content: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const html = marked.parse(props.content, { async: false }) as string;
    containerRef.current.innerHTML = DOMPurify.sanitize(html);
  }, [props.content]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void window.appShell.openExternal(href);
  };

  return (
    <div
      ref={containerRef}
      className="about-markdown-content"
      onClick={handleClick}
    />
  );
}

function PluginChangelogTab(props: { pluginId: string }): JSX.Element | null {
  const entries = getChangelogEntries();
  const entry = entries.find((e) => e.pluginId === props.pluginId);
  if (!entry) {
    return null;
  }
  return (
    <div className="about-changelog-content">
      <h3>{entry.pluginName} <span className="about-changelog-version">v{entry.version}</span></h3>
      <MarkdownRenderer content={entry.changelog} />
    </div>
  );
}
