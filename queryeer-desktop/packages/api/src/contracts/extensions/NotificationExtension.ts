export type NotificationSeverity = "info" | "success" | "warning" | "error";

export type NotificationAction = {
  id: string;
  label: string;
  run: () => void | Promise<void>;
};

export type NotificationRequest = {
  title: string;
  message?: string;
  severity?: NotificationSeverity;
  actions?: NotificationAction[];
};

export type NotificationRecord = NotificationRequest & {
  id: string;
  severity: NotificationSeverity;
  createdAt: string;
  read: boolean;
  toastDismissed: boolean;
};

export type NotificationService = {
  notify: (notification: NotificationRequest) => NotificationRecord;
  list: () => NotificationRecord[];
  unreadCount: () => number;
  markRead: (notificationId: string) => void;
  markAllRead: () => void;
  dismissToast: (notificationId: string) => void;
  clear: (notificationId: string) => void;
  clearAll: () => void;
  subscribe: (listener: () => void) => () => void;
};
