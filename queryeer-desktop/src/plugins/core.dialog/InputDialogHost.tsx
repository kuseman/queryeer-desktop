import * as React from "react";
import {
  getActiveInputDialogRequest,
  resolveActiveInputDialog,
  subscribeInputDialog
} from "./input-dialog-service";
import "./input-dialog.css";

export function InputDialogHost(): JSX.Element | null {
  const [version, setVersion] = React.useState(0);
  const [value, setValue] = React.useState("");
  const previousFocusedElementRef = React.useRef<HTMLElement | null>(null);
  const hadActiveRequestRef = React.useRef(false);

  React.useEffect(() => {
    return subscribeInputDialog(() => {
      setVersion((previous) => previous + 1);
    });
  }, []);

  const request = getActiveInputDialogRequest();

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
      setValue("");
      return;
    }
    setValue("");
  }, [request, version]);

  if (!request) {
    return null;
  }

  return (
    <div className="dialog-input-overlay" role="dialog" aria-modal="true" aria-label={request.options.title}>
      <div className="dialog-input-modal">
        <header className="dialog-input-header">
          <h2>{request.options.title}</h2>
        </header>
        <p className="dialog-input-message">{request.options.message}</p>
        <input
          className="dialog-input-field"
          type={request.options.password ? "password" : "text"}
          autoComplete="off"
          value={value}
          placeholder={request.options.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              resolveActiveInputDialog({ canceled: false, value });
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              resolveActiveInputDialog({ canceled: true, value: undefined });
            }
          }}
          autoFocus
        />
        <div className="dialog-input-actions">
          <button
            type="button"
            className="dialog-input-button"
            onClick={() => resolveActiveInputDialog({ canceled: true, value: undefined })}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dialog-input-button primary"
            onClick={() => resolveActiveInputDialog({ canceled: false, value })}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
