import * as React from "react";
import {
  getActiveMessageDialogRequest,
  resolveActiveMessageDialog,
  subscribeMessageDialog
} from "./message-dialog-service";
import "./message-dialog.css";

export function MessageDialogHost(): JSX.Element | null {
  const [, setVersion] = React.useState(0);
  const primaryButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousFocusedElementRef = React.useRef<HTMLElement | null>(null);
  const hadActiveRequestRef = React.useRef(false);

  React.useEffect(() => {
    return subscribeMessageDialog(() => {
      setVersion((value) => value + 1);
    });
  }, []);

  const request = getActiveMessageDialogRequest();

  if (request && !hadActiveRequestRef.current) {
    const active = document.activeElement;
    previousFocusedElementRef.current = active instanceof HTMLElement ? active : null;
    hadActiveRequestRef.current = true;
  }

  React.useEffect(() => {
    if (!request && hadActiveRequestRef.current) {
      hadActiveRequestRef.current = false;
      const previous = previousFocusedElementRef.current;
      previousFocusedElementRef.current = null;
      if (previous && previous.isConnected) {
        previous.focus();
      }
    }
  }, [request]);

  React.useEffect(() => {
    if (!request) {
      return;
    }
    primaryButtonRef.current?.focus();
  }, [request]);

  if (!request) {
    return null;
  }

  const options = request.options.options ?? [{ label: "OK", value: "" }];

  return (
    <div
      className="dialog-message-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={request.options.title}
      onKeyDown={(event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        resolveActiveMessageDialog({ action: options[0]?.value ?? "" });
      }}
    >
      <div className="dialog-message-modal">
        <header className="dialog-message-header">
          <h2>{request.options.title}</h2>
        </header>
        <p className={`dialog-message-body severity-${request.options.severity ?? "info"}`}>
          {request.options.message}
        </p>
        {request.options.detail && <pre className="dialog-message-detail">{request.options.detail}</pre>}
        <div className="dialog-message-actions">
          {options.map((option, index) => (
            <button
              key={`${option.value}-${index}`}
              type="button"
              ref={index === 0 ? primaryButtonRef : undefined}
              className={`dialog-message-button${index === 0 ? " primary" : ""}`}
              onClick={() => resolveActiveMessageDialog({ action: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
