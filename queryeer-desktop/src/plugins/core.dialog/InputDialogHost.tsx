import { useEffect, useState } from "react";
import {
  getActiveInputDialogRequest,
  resolveActiveInputDialog,
  subscribeInputDialog
} from "./input-dialog-service";
import "./input-dialog.css";

export function InputDialogHost(): JSX.Element | null {
  const [version, setVersion] = useState(0);
  const [value, setValue] = useState("");

  useEffect(() => {
    return subscribeInputDialog(() => {
      setVersion((previous) => previous + 1);
    });
  }, []);

  const request = getActiveInputDialogRequest();

  useEffect(() => {
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
              resolveActiveInputDialog({ canceled: false, value });
            }
            if (event.key === "Escape") {
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
