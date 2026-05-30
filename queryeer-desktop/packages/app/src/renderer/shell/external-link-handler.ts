export function installGlobalExternalLinkHandler(documentRef: Document = document): () => void {
  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest("a[href]");
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href || !shouldOpenExternally(href)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void window.appShell.openExternal(href);
  };

  documentRef.addEventListener("click", onClick);
  return () => {
    documentRef.removeEventListener("click", onClick);
  };
}

export function shouldOpenExternally(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return false;
  }
  return /^(https?:|mailto:)/i.test(trimmed);
}
