import type {
  NotificationRecord,
  NotificationRequest,
  NotificationService
} from "../../contracts/extensions/NotificationExtension";

export class InMemoryNotificationService implements NotificationService {
  private readonly notifications: NotificationRecord[] = [];
  private readonly listeners = new Set<() => void>();

  public notify(notification: NotificationRequest): NotificationRecord {
    const record: NotificationRecord = {
      ...notification,
      id: `notification-${crypto.randomUUID()}`,
      severity: notification.severity ?? "info",
      createdAt: new Date().toISOString(),
      read: false,
      toastDismissed: false
    };
    this.notifications.unshift(record);
    this.emitChanged();
    return record;
  }

  public list(): NotificationRecord[] {
    return [...this.notifications];
  }

  public unreadCount(): number {
    return this.notifications.filter((item) => !item.read).length;
  }

  public markRead(notificationId: string): void {
    const notification = this.notifications.find((item) => item.id === notificationId);
    if (!notification || notification.read) {
      return;
    }
    notification.read = true;
    this.emitChanged();
  }

  public markAllRead(): void {
    let changed = false;
    for (const notification of this.notifications) {
      if (!notification.read) {
        notification.read = true;
        changed = true;
      }
    }
    if (changed) {
      this.emitChanged();
    }
  }

  public dismissToast(notificationId: string): void {
    const notification = this.notifications.find((item) => item.id === notificationId);
    if (!notification || notification.toastDismissed) {
      return;
    }
    notification.toastDismissed = true;
    this.emitChanged();
  }

  public clear(notificationId: string): void {
    const index = this.notifications.findIndex((item) => item.id === notificationId);
    if (index === -1) {
      return;
    }
    this.notifications.splice(index, 1);
    this.emitChanged();
  }

  public clearAll(): void {
    if (this.notifications.length === 0) {
      return;
    }
    this.notifications.length = 0;
    this.emitChanged();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChanged(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const notificationService = new InMemoryNotificationService();

export function getNotificationService(): NotificationService {
  return notificationService;
}
