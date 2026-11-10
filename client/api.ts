export let csrfToken = "";
export function setCsrf(value: string) {
  csrfToken = value;
}
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "X-CSRF-Token": csrfToken,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(body.error ?? "Không thể kết nối máy chủ.");
  }
  return body;
}
export const post = <T = any>(url: string, body: unknown = {}) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });
export const date = (value: any) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(Number(value)))
    : "—";
export const duration = (start: any, end: any) => {
  if (!start) return "—";
  const seconds = Math.max(
    0,
    Math.floor((Number(end || Date.now()) - Number(start)) / 1000),
  );
  return `${Math.floor(seconds / 60)}p ${seconds % 60}s`;
};
export const roleName: Record<string, string> = {
  admin: "Quản trị viên",
  operator: "Vận hành",
  auditor: "Kiểm toán viên",
};
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
}
export interface Asset {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  os: string;
  groupName: string;
  description: string;
  enabled: boolean;
  username?: string;
  domain?: string;
  hostKey?: string;
  ignoreCert?: boolean;
}
