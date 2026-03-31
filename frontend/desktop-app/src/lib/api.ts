import { useSessionStore } from "../stores/session-store";

type RequestOptions = RequestInit & {
  skipAuth?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = useSessionStore.getState().token;
  const headers = new Headers(options.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (!options.skipAuth && token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  
  // Request Logging
  console.log(`[API Request] ${options.method || 'GET'} ${path}`);

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers
    });
  } catch (err: any) {
    console.error(`[API Error] Request failed to connect: ${path}`, err);
    throw err;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const errorMessage = payload?.message ?? `Request failed: ${response.status}`;
    console.error(`[API Error] Response error: Status ${response.status} on ${path} -`, payload || errorMessage);
    throw new Error(errorMessage);
  }
  
  const data = await response.json();
  return data as T;
}

export const api = {
  login: (payload: { account: string; password: string; remember_me: boolean }) =>
    request<{ user_id: string; token: string; expire_time: number }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
      skipAuth: true
    }),
  me: () => request<{ user_id: string; username: string; email: string; phone: string; avatar?: string }>("/api/me"),
  logout: () => request<{ success: boolean }>("/api/auth/logout", { method: "POST" }),
  listInstances: (params: URLSearchParams) => request<InstanceListResponse>(`/api/console/instances?${params.toString()}`),
  getInstance: (id: string) => request<InstanceDetail>(`/api/console/instances/${id}`),
  runAction: (id: string, action: "start" | "stop" | "reboot") =>
    request<{ instance_id: string; status: string; message: string }>(`/api/console/instances/${id}/${action}`, {
      method: "POST"
    }),
  getConsole: (id: string) => request<{ console_url: string; expire_at: string }>(`/api/console/instances/${id}/console`)
};

export type InstanceListItem = {
  instance_id: string;
  instance_name: string;
  board_type: string;
  ip_address: string;
  status: string;
  billing_mode: string;
  expire_at: string;
  created_at: string;
  image_name?: string;
  is_desktop_system: boolean;
  os_name: string;
  desktop_env: string;
  desktop_status: string;
};

export type InstanceListResponse = {
  total: number;
  list: InstanceListItem[];
  stats: Record<string, number>;
};

export type InstanceDetail = {
  instance_id: string;
  instance_name: string;
  ip_address: string;
  mac_address: string;
  status: string;
  order_id: string;
  region_name: string;
  monthly_price: string;
  expire_at: string;
  created_at: string;
  updated_at: string;
  board_type?: string;
  image_name?: string;
  is_desktop_system: boolean;
  os_name: string;
  desktop_env: string;
  desktop_status: string;
};
