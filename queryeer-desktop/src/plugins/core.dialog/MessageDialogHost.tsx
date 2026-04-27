import { useEffect, useState } from "react";
import {
  getActiveMessageDialogRequest,
  resolveActiveMessageDialog,
  subscribeMessageDialog
} from "./message-dialog-service";
import "./message-dialog.css";

export function MessageDialogHost(): JSX.Element | null {
  const [, setVersion] = useState(0);

  useEffect(() => {
    return subscribeMessageDialog(() => {
      setVersion((value) => value + 1);
    });
  }, []);

  const request = getActiveMessageDialogRequest();
  if (!request) {
    return null;
  }

  const options = request.options.options ?? [{ label: "OK", value: "" }];

  return (
    <div className="dialog-message-overlay" role="dialog" aria-modal="true" aria-label={request.options.title}>
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
