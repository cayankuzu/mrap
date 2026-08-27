import type { UserListPlayer } from "@/lib/models";

export type NotificationClientItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  href: string | null;
};

export type NotificationFollowRequest = { user: UserListPlayer; requestedAt: string };

export type NotificationClientState = {
  items: NotificationClientItem[];
  requests: NotificationFollowRequest[];
};

export type NotificationClientAction =
  | { type: "synchronize"; items: NotificationClientItem[]; requests: NotificationFollowRequest[] }
  | { type: "mark-all-read"; readAt: string }
  | { type: "resolve-request"; requesterId: string };

export function notificationClientReducer(state: NotificationClientState, action: NotificationClientAction): NotificationClientState {
  if (action.type === "synchronize") return { items: action.items, requests: action.requests };
  if (action.type === "mark-all-read") {
    return { ...state, items: state.items.map((item) => ({ ...item, read_at: action.readAt })) };
  }
  return { ...state, requests: state.requests.filter((request) => request.user.id !== action.requesterId) };
}
