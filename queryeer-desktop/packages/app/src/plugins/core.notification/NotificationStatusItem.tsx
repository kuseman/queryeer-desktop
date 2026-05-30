import { useEffect, useRef, useState } from "react";
import type { NotificationRecord } from "@queryeer/api/extensions/NotificationExtension";
import { getNotificationService } from "./notification-service";

export function NotificationStatusItem(): JSX.Element {
  const service = getNotificationService();
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => service.subscribe(() => setVersion((current) => current + 1)), [service]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const notifications = service.list();
  const unread = service.unreadCount();
  void version;

  return (
    <span className="notification-status" ref={rootRef}>
      <button
        type="button"
        className={`notification-status-button${unread > 0 ? " has-unread" : ""}`}
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) {
            service.markAllRead();
          }
        }}
      >
        <BellIcon />
        {unread > 0 ? <span className="notification-status-badge">{unread}</span> : null}
      </button>
      {open ? <NotificationPopover notifications={notifications} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function NotificationPopover({
  notifications,
  onClose
}: {
  notifications: NotificationRecord[];
  onClose: () => void;
}): JSX.Element {
  const service = getNotificationService();
  return (
    <div className="notification-popover" role="dialog" aria-label="Notifications">
      <div className="notification-popover-header">
        <strong>Notifications</strong>
        <div className="notification-popover-actions">
          <button type="button" onClick={() => service.clearAll()} disabled={notifications.length === 0}>
            Clear all
          </button>
          <button type="button" onClick={onClose} aria-label="Close notifications">
            Close
          </button>
        </div>
      </div>
      <div className="notification-popover-list">
        {notifications.length === 0 ? (
          <p className="notification-empty">No notifications</p>
        ) : (
          notifications.map((notification) => (
            <NotificationCard key={notification.id} notification={notification} mode="popover" />
          ))
        )}
      </div>
    </div>
  );
}

export function BellIcon(): JSX.Element {
  return (
    <svg className="notification-bell-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 22a2.5 2.5 0 0 0 2.4-1.8H9.6A2.5 2.5 0 0 0 12 22Zm7-5-1.8-2.1V10a5.2 5.2 0 0 0-4-5.1V4a1.2 1.2 0 1 0-2.4 0v.9a5.2 5.2 0 0 0-4 5.1v4.9L5 17v1.2h14V17Z"
      />
    </svg>
  );
}

export function NotificationCard({
  notification,
  mode
}: {
  notification: NotificationRecord;
  mode: "toast" | "popover";
}): JSX.Element {
  const service = getNotificationService();
  return (
    <article className={`notification-card notification-${notification.severity} notification-card-${mode}`}>
      <div className="notification-card-main">
        <div className="notification-card-title-row">
          <strong>{notification.title}</strong>
          <button
            type="button"
            className="notification-card-close"
            aria-label={mode === "toast" ? "Dismiss notification" : "Clear notification"}
            onClick={() => {
              if (mode === "toast") {
                service.dismissToast(notification.id);
              } else {
                service.clear(notification.id);
              }
            }}
          >
            x
          </button>
        </div>
        {notification.message ? <p>{notification.message}</p> : null}
        {notification.actions && notification.actions.length > 0 ? (
          <div className="notification-card-actions">
            {notification.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => {
                  service.markRead(notification.id);
                  void action.run();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
