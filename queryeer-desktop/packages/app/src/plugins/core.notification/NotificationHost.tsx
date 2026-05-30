import { useEffect, useState } from "react";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../core.settings/service";
import { getNotificationService } from "./notification-service";
import { NotificationCard } from "./NotificationStatusItem";

const TOASTS_ENABLED_SETTING_ID = "core.notification.toasts.enabled";
const TOAST_AUTO_DISMISS_MS = 10000;

export function NotificationHost(): JSX.Element | null {
  const service = getNotificationService();
  const [version, setVersion] = useState(0);

  useEffect(() => service.subscribe(() => setVersion((current) => current + 1)), [service]);

  useEffect(() => {
    let unsubscribeSettings: (() => void) | undefined;
    const unsubscribeReady = onCoreSettingsServiceInitialized((settings) => {
      unsubscribeSettings = settings.subscribe(() => setVersion((current) => current + 1));
      setVersion((current) => current + 1);
    });
    return () => {
      unsubscribeReady();
      unsubscribeSettings?.();
    };
  }, []);

  useEffect(() => {
    const timers = service
      .list()
      .filter((notification) => !notification.toastDismissed)
      .map((notification) =>
        setTimeout(() => service.dismissToast(notification.id), TOAST_AUTO_DISMISS_MS)
      );
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [service, version]);

  const settings = getCoreSettingsService();
  const toastsEnabled = settings?.getValue(TOASTS_ENABLED_SETTING_ID) !== false;
  const toasts = toastsEnabled
    ? service.list().filter((notification) => !notification.toastDismissed).slice(0, 4).reverse()
    : [];

  if (toasts.length === 0) {
    return null;
  }

  return (
    <section className="notification-toast-stack" aria-label="Notifications" aria-live="polite">
      {toasts.map((notification) => (
        <NotificationCard key={notification.id} notification={notification} mode="toast" />
      ))}
    </section>
  );
}
