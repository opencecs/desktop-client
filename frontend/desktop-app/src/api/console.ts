import { ApiError, getApiBaseUrl, requestJson } from "@/api/client";
import { createLogger } from "@/lib/logger";
import { normalizePortMappingProtocolFilter } from "@/lib/port-mapping";
import type {
  AuthSession,
  BatchActionResult,
  BindEmailInput,
  BindPhoneInput,
  ChangePasswordInput,
  ConsoleLinkResult,
  CurrentUser,
  DashboardResponse,
  InstanceActionResult,
  InstanceDetail,
  OpLogEntry,
  OpLogListResponse,
  PortMappingBatchCreateInput,
  PortMappingBatchCreateResult,
  PortMappingBatchDeleteResult,
  PortMappingCreateInput,
  PortMappingDeleteResult,
  PortMappingListResponse,
  PortMappingOverview,
  PortMappingRule,
  PortMappingStats,
  PortMappingUpdateInput,
  RenewInstanceInput,
  RenewInstanceResult,
  SendCodeInput,
  StorageCreateFolderInput,
  StorageCreateFolderResult,
  StorageDeleteResult,
  StorageFileItem,
  StorageFileListResponse,
  StorageInstance,
  StorageInstanceListResponse,
  StorageOverview,
  SwitchIpResult,
  SwitchOsInput,
  SwitchOsResult,
  InstanceSummary,
  LoginInput,
} from "@/types";

const consoleLogger = createLogger("console-api");

/** 解包 API 响应的通用数据包装层 */
function unwrapApiPayload(payload: any) {
  return payload?.data ?? payload?.result ?? payload;
}

/** 规范化头像 URL，避免桌面端 file:// 场景下协议相对路径失效 */
function normalizeAvatarUrl(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;

  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }

  const base = getApiBaseUrl().replace(/\/+$/, "");
  if (value.startsWith("/")) {
    return `${base}${value}`;
  }
  return `${base}/${value}`;
}

/** 标准化用户信息字段 */
function normalizeUser(payload: any): CurrentUser {
  const body = unwrapApiPayload(payload);
  const user = body?.user ?? body;
  return {
    userId: String(user?.user_id ?? user?.userId ?? "user-admin-001"),
    username: String(user?.username ?? user?.name ?? "admin"),
    phone: user?.phone ? String(user.phone) : undefined,
    email: user?.email ? String(user.email) : undefined,
    avatar: normalizeAvatarUrl(user?.avatar),
    role: user?.role ? String(user.role) : undefined,
    userType: user?.user_type ? String(user.user_type) : user?.userType ? String(user.userType) : undefined,
    isVerified: typeof (user?.is_verified ?? user?.isVerified) === "boolean" ? Boolean(user?.is_verified ?? user?.isVerified) : undefined,
  };
}

function normalizeExpireTime(payload: any): number | undefined {
  const body = unwrapApiPayload(payload);
  const raw = body?.expire_time ?? body?.expireTime;
  const normalized = Number(raw);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined;
}

function toIsoFromUnix(expireTime?: number): string | undefined {
  if (!expireTime) {
    return undefined;
  }
  return new Date(expireTime * 1000).toISOString();
}

function normalizeSession(payload: any, source: "api"): AuthSession {
  const body = unwrapApiPayload(payload);
  const user = body?.user ? normalizeUser(body.user) : normalizeUser(body);
  const expireTime = normalizeExpireTime(payload);

  return {
    accessToken: String(body?.access_token ?? body?.token ?? body?.accessToken ?? ""),
    refreshToken: body?.refresh_token ? String(body.refresh_token) : body?.refreshToken ? String(body.refreshToken) : undefined,
    expiresAt: body?.expires_at ? String(body.expires_at) : body?.expiresAt ? String(body.expiresAt) : toIsoFromUnix(expireTime),
    expireTime,
    source,
    user,
  };
}

function normalizeInstance(payload: any): InstanceSummary {
  const body = unwrapApiPayload(payload);
  // Keep the field optional until upstream ships a real `is_desktop` flag.
  const explicitIsDesktop = body?.is_desktop ?? body?.isDesktop;
  const normalizedIsDesktop = typeof explicitIsDesktop === "boolean" ? explicitIsDesktop : undefined;
  const normalizedIsDesktopSystem = body?.is_desktop_system ?? body?.isDesktopSystem ?? normalizedIsDesktop ?? true;

  return {
    instanceId: String(body?.instance_id ?? body?.instanceId ?? ""),
    instanceName: String(body?.instance_name ?? body?.instanceName ?? ""),
    boardType: String(body?.board_type ?? body?.boardType ?? ""),
    boardName: body?.board_name ? String(body.board_name) : body?.boardName ? String(body.boardName) : undefined,
    imageName: body?.image_name ? String(body.image_name) : body?.imageName ? String(body.imageName) : undefined,
    ipAddress: String(body?.ip_address ?? body?.ipAddress ?? ""),
    status: String(body?.status ?? "pending"),
    billingMode: String(body?.billing_mode ?? body?.billingMode ?? "monthly"),
    expireAt: String(body?.expire_at ?? body?.expireAt ?? ""),
    createdAt: String(body?.created_at ?? body?.createdAt ?? ""),
    regionName: body?.region_name ? String(body.region_name) : body?.regionName ? String(body.regionName) : undefined,
    monthlyPrice: body?.monthly_price ? String(body.monthly_price) : body?.monthlyPrice ? String(body.monthlyPrice) : undefined,
    memory: body?.memory ? Number(body.memory) : body?.memoryGb ? Number(body.memoryGb) : undefined,
    diskSize: body?.disk_size !== undefined ? Number(body.disk_size) : body?.diskSize !== undefined ? Number(body.diskSize) : undefined,
    bandwidth: body?.bandwidth !== undefined ? Number(body.bandwidth) : undefined,
    bandwidthType: body?.bandwidth_type ? String(body.bandwidth_type) : body?.bandwidthType ? String(body.bandwidthType) : undefined,
    isDesktop: normalizedIsDesktop,
    isDesktopSystem: Boolean(normalizedIsDesktopSystem),
    osName: body?.os_name ? String(body.os_name) : body?.osName ? String(body.osName) : undefined,
    desktopEnv: body?.desktop_env ? String(body.desktop_env) : body?.desktopEnv ? String(body.desktopEnv) : undefined,
    desktopStatus: body?.desktop_status ? String(body.desktop_status) : body?.desktopStatus ? String(body.desktopStatus) : undefined,
    networkStatus: body?.network_status ? String(body.network_status) : body?.networkStatus ? String(body.networkStatus) : undefined,
  };
}

function normalizeDetail(payload: any): InstanceDetail {
  const body = unwrapApiPayload(payload);
  const instance = body?.instance ?? body;

  return {
    ...normalizeInstance(instance),
    macAddress: instance?.mac_address ? String(instance.mac_address) : instance?.macAddress ? String(instance.macAddress) : undefined,
    updatedAt: instance?.updated_at ? String(instance.updated_at) : instance?.updatedAt ? String(instance.updatedAt) : undefined,
    orderId: instance?.order_id ? String(instance.order_id) : instance?.orderId ? String(instance.orderId) : undefined,
    consoleUrl: instance?.console_url ? String(instance.console_url) : instance?.consoleUrl ? String(instance.consoleUrl) : instance?.url ? String(instance.url) : undefined,
    description: instance?.description ? String(instance.description) : undefined,
  };
}

function normalizeDashboard(payload: any): DashboardResponse {
  const body = unwrapApiPayload(payload);
  const items = Array.isArray(body?.list)
    ? body.list
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.instances)
        ? body.instances
        : [];

  return {
    source: "api",
    total: Number(body?.total ?? items.length),
    items: items.map(normalizeInstance),
    stats: body?.stats
      ? {
          total: Number(body.stats.total ?? body.total ?? items.length),
          desktop: Number(body.stats.desktop ?? 0),
          running: Number(body.stats.running ?? 0),
          stopped: Number(body.stats.stopped ?? 0),
          expired: Number(body.stats.expired ?? 0),
        }
      : undefined,
  };
}

function normalizePortMappingStats(payload: any): PortMappingStats {
  return {
    used: Number(payload?.used ?? 0),
    quota: Number(payload?.quota ?? 0),
    activeCount: Number(payload?.active_count ?? payload?.activeCount ?? 0),
    failedCount: Number(payload?.failed_count ?? payload?.failedCount ?? 0),
  };
}

function normalizePortMappingOverview(payload: any): PortMappingOverview {
  const body = unwrapApiPayload(payload);
  return {
    instanceId: String(body?.instance_id ?? body?.instanceId ?? ""),
    instanceName: body?.instance_name ? String(body.instance_name) : body?.instanceName ? String(body.instanceName) : undefined,
    privateIp: body?.private_ip ? String(body.private_ip) : body?.privateIp ? String(body.privateIp) : undefined,
    natPublicIp: body?.nat_public_ip ? String(body.nat_public_ip) : body?.natPublicIp ? String(body.natPublicIp) : undefined,
    tcp: normalizePortMappingStats(body?.tcp),
    udp: normalizePortMappingStats(body?.udp),
  };
}

function normalizePortMappingRule(payload: any): PortMappingRule {
  return {
    mappingId: String(payload?.mapping_id ?? payload?.mappingId ?? ""),
    protocol: String(payload?.protocol ?? "").toUpperCase(),
    publicPort: Number(payload?.public_port ?? payload?.publicPort ?? 0),
    privatePort: Number(payload?.private_port ?? payload?.privatePort ?? 0),
    remark: payload?.remark ? String(payload.remark) : undefined,
    proxyStatus: payload?.proxy_status ? String(payload.proxy_status) : payload?.proxyStatus ? String(payload.proxyStatus) : undefined,
    failReason: payload?.fail_reason ? String(payload.fail_reason) : payload?.failReason ? String(payload.failReason) : undefined,
    createdAt: payload?.created_at ? String(payload.created_at) : payload?.createdAt ? String(payload.createdAt) : undefined,
  };
}

function normalizePortMappingList(payload: any): PortMappingListResponse {
  const body = unwrapApiPayload(payload);
  const items = Array.isArray(body?.list) ? body.list : Array.isArray(body?.items) ? body.items : [];
  return {
    total: Number(body?.total ?? items.length),
    items: items.map(normalizePortMappingRule),
  };
}

function normalizePortMappingDeleteResult(payload: any, mappingId: string): PortMappingDeleteResult {
  const body = unwrapApiPayload(payload);
  return {
    mappingId: String(body?.mapping_id ?? body?.mappingId ?? mappingId),
    success: body?.success !== false,
    message: String(body?.message ?? body?.detail ?? "端口映射已删除"),
  };
}

function normalizePortMappingBatchCreateResult(payload: any): PortMappingBatchCreateResult {
  const body = unwrapApiPayload(payload);
  const results = Array.isArray(body?.results) ? body.results : [];
  return {
    total: Number(body?.total ?? results.length),
    succeeded: Number(body?.succeeded ?? 0),
    failed: Number(body?.failed ?? 0),
    results: results.map((item: any) => ({
      index: Number(item?.index ?? 0),
      success: Boolean(item?.success),
      data: item?.data ? normalizePortMappingRule(item.data) : undefined,
      reason: item?.reason ? String(item.reason) : item?.message ? String(item.message) : undefined,
    })),
  };
}

function normalizePortMappingBatchDeleteResult(payload: any): PortMappingBatchDeleteResult {
  const body = unwrapApiPayload(payload);
  const results = Array.isArray(body?.results) ? body.results : [];
  return {
    total: Number(body?.total ?? results.length),
    succeeded: Number(body?.succeeded ?? 0),
    failed: Number(body?.failed ?? 0),
    results: results.map((item: any) => ({
      mappingId: String(item?.mapping_id ?? item?.mappingId ?? ""),
      success: Boolean(item?.success),
      reason: item?.reason ? String(item.reason) : item?.message ? String(item.message) : undefined,
    })),
  };
}

export const consoleApi = {
  /** 登录 — 优先尝试 /auth/login/account，404 时回退到 /auth/login */
  async login(payload: LoginInput): Promise<AuthSession> {
    try {
      consoleLogger.debug("login:start", { username: payload.username });
      const response = await requestJson<any>("/auth/login/account", {
        method: "POST",
        json: {
          account: payload.username,
          username: payload.username,
          password: payload.password,
          remember_me: payload.rememberMe,
        },
      });

      const session = normalizeSession(response, "api");
      consoleLogger.debug("login:success", { username: session.user.username });

      // 登录返回的用户信息不完整时，从 /me 补充
      if (!session.user?.username) {
        const me = await consoleApi.fetchCurrentUser(session.accessToken);
        return { ...session, user: me, source: "api" };
      }

      // 补充缺失的用户详细信息
      if (!session.user.email || !session.user.phone || !session.user.avatar) {
        try {
          const me = await consoleApi.fetchCurrentUser(session.accessToken);
          return {
            ...session,
            user: { ...session.user, ...me },
            source: "api",
          };
        } catch (error) {
          consoleLogger.warn("login:me-merge-skipped", { error: String(error) });
        }
      }

      return session;
    } catch (error) {
      // /auth/login/account 返回 404 时尝试旧接口
      if (error instanceof ApiError && error.kind === "http" && error.status === 404) {
        consoleLogger.debug("login:fallback-to-legacy-endpoint");
        const response = await requestJson<any>("/auth/login", {
          method: "POST",
          json: {
            account: payload.username,
            username: payload.username,
            password: payload.password,
            remember_me: payload.rememberMe,
          },
        });
        return normalizeSession(response, "api");
      }
      throw error;
    }
  },

  /** 获取当前登录用户信息 */
  async fetchCurrentUser(token?: string): Promise<CurrentUser> {
    try {
      const response = await requestJson<any>("/user/info", { method: "GET", token });
      consoleLogger.debug("user:info:loaded");
      return normalizeUser(response);
    } catch (error) {
      // /user/info 不存在时回退到 /me
      if (error instanceof ApiError && error.kind === "http" && error.status === 404) {
        consoleLogger.debug("user:info:fallback-to-me");
        const response = await requestJson<any>("/me", { method: "GET", token });
        return normalizeUser(response);
      }
      throw error;
    }
  },

  /** 获取仪表板实例列表 */
  async fetchDashboard(token?: string): Promise<DashboardResponse> {
    const response = await requestJson<any>("/console/instances", { method: "GET", token });
    consoleLogger.debug("dashboard:loaded");
    return normalizeDashboard(response);
  },

  /** 获取实例详情 */
  async fetchInstanceDetail(instanceId: string, token?: string): Promise<InstanceDetail> {
    const response = await requestJson<any>(`/console/instances/${instanceId}`, { method: "GET", token });
    consoleLogger.debug("instance:detail:loaded", { instanceId });
    return normalizeDetail(response);
  },

  /** 启动实例 */
  async startInstance(instanceId: string, token?: string): Promise<InstanceActionResult> {
    consoleLogger.debug("instance:start", { instanceId });
    const response = await requestJson<any>(`/console/instances/${instanceId}/start`, { method: "POST", token });
    return normalizeActionResult(instanceId, response, "实例启动请求已提交");
  },

  /** 停止实例 */
  async stopInstance(instanceId: string, token?: string): Promise<InstanceActionResult> {
    consoleLogger.debug("instance:stop", { instanceId });
    const response = await requestJson<any>(`/console/instances/${instanceId}/stop`, { method: "POST", token });
    return normalizeActionResult(instanceId, response, "实例停止请求已提交");
  },

  /** 重启实例 */
  async rebootInstance(instanceId: string, token?: string): Promise<InstanceActionResult> {
    consoleLogger.debug("instance:reboot", { instanceId });
    const response = await requestJson<any>(`/console/instances/${instanceId}/reboot`, { method: "POST", token });
    return normalizeActionResult(instanceId, response, "实例重启请求已提交");
  },

  /** 获取 VNC 控制台链接 */
  async getConsoleLink(instanceId: string, token?: string): Promise<ConsoleLinkResult> {
    const response = await requestJson<any>(`/console/instances/${instanceId}/console`, { method: "GET", token });
    const body = unwrapApiPayload(response);
    consoleLogger.debug("console:link:loaded", { instanceId });
    return {
      instanceId: String(body?.instance_id ?? body?.instanceId ?? instanceId),
      consoleUrl: String(body?.console_url ?? body?.consoleUrl ?? body?.url ?? ""),
      expiresAt: body?.expire_at ? String(body.expire_at) : body?.expiresAt ? String(body.expiresAt) : undefined,
    };
  },

  /** 获取端口映射概览 */
  async fetchPortMappingOverview(instanceId: string, token?: string): Promise<PortMappingOverview> {
    try {
      const response = await requestJson<any>(`/console/instances/${instanceId}/port-mappings/overview`, { method: "GET", token });
      consoleLogger.debug("port-mapping:overview:loaded", { instanceId });
      return normalizePortMappingOverview(response);
    } catch (error) {
      // 上游业务错误（如"实例内网IP未配置"）返回 422，此时返回空概览并携带警告信息
      if (error instanceof ApiError && error.kind === "http" && (error.status === 422 || error.status === 502)) {
        consoleLogger.warn("port-mapping:overview:business-error", { instanceId, status: error.status, message: error.message });
        return {
          instanceId,
          privateIp: undefined,
          natPublicIp: undefined,
          tcp: { quota: 0, used: 0, activeCount: 0, failedCount: 0 },
          udp: { quota: 0, used: 0, activeCount: 0, failedCount: 0 },
          _warning: error.message,
        } as PortMappingOverview;
      }
      throw error;
    }
  },

  /** 获取端口映射列表 */
  async fetchPortMappings(instanceId: string, token?: string, protocol?: string): Promise<PortMappingListResponse> {
    const query = new URLSearchParams({ page: "1", page_size: "50" });
    const normalizedProtocol = normalizePortMappingProtocolFilter(protocol);
    if (normalizedProtocol !== "ALL") {
      query.set("protocol", normalizedProtocol);
    }
    const response = await requestJson<any>(`/console/instances/${instanceId}/port-mappings?${query.toString()}`, { method: "GET", token });
    consoleLogger.debug("port-mapping:list:loaded", { instanceId, protocol: normalizedProtocol });
    return normalizePortMappingList(response);
  },

  /** 创建端口映射 */
  async createPortMapping(instanceId: string, input: PortMappingCreateInput, token?: string): Promise<PortMappingRule> {
    consoleLogger.debug("port-mapping:create:start", { instanceId, protocol: input.protocol });
    const response = await requestJson<any>(`/console/instances/${instanceId}/port-mappings`, {
      method: "POST",
      token,
      json: { protocol: input.protocol, private_port: input.privatePort, remark: input.remark },
    });
    const normalized = normalizePortMappingRule(response);
    consoleLogger.debug("port-mapping:create:success", { instanceId, mappingId: normalized.mappingId });
    return normalized;
  },

  /** 更新端口映射 */
  async updatePortMapping(instanceId: string, mappingId: string, input: PortMappingUpdateInput, token?: string): Promise<PortMappingRule> {
    consoleLogger.debug("port-mapping:update:start", { instanceId, mappingId });
    const response = await requestJson<any>(`/console/instances/${instanceId}/port-mappings/${mappingId}`, {
      method: "PATCH",
      token,
      json: { private_port: input.privatePort, remark: input.remark },
    });
    const normalized = normalizePortMappingRule(response);
    consoleLogger.debug("port-mapping:update:success", { instanceId, mappingId: normalized.mappingId });
    return normalized;
  },

  /** 删除端口映射 */
  async deletePortMapping(instanceId: string, mappingId: string, token?: string): Promise<PortMappingDeleteResult> {
    consoleLogger.debug("port-mapping:delete:start", { instanceId, mappingId });
    const response = await requestJson<any>(`/console/instances/${instanceId}/port-mappings/${mappingId}`, { method: "DELETE", token });
    const normalized = normalizePortMappingDeleteResult(response, mappingId);
    consoleLogger.debug("port-mapping:delete:success", { instanceId, mappingId, success: normalized.success });
    return normalized;
  },

  /** 批量创建端口映射 */
  async batchCreatePortMappings(instanceId: string, input: PortMappingBatchCreateInput, token?: string): Promise<PortMappingBatchCreateResult> {
    consoleLogger.debug("port-mapping:batch-create:start", { instanceId, count: input.rules.length });
    const response = await requestJson<any>(`/console/instances/${instanceId}/port-mappings/batch`, {
      method: "POST",
      token,
      json: {
        rules: input.rules.map((rule) => ({
          protocol: rule.protocol,
          private_port: rule.privatePort,
          remark: rule.remark,
        })),
      },
    });
    const normalized = normalizePortMappingBatchCreateResult(response);
    consoleLogger.debug("port-mapping:batch-create:success", { instanceId, succeeded: normalized.succeeded, failed: normalized.failed });
    return normalized;
  },

  /** 批量删除端口映射 */
  async batchDeletePortMappings(instanceId: string, mappingIds: string[], token?: string): Promise<PortMappingBatchDeleteResult> {
    consoleLogger.debug("port-mapping:batch-delete:start", { instanceId, count: mappingIds.length });
    const response = await requestJson<any>(`/console/instances/${instanceId}/port-mappings/batch`, {
      method: "DELETE",
      token,
      json: { mapping_ids: mappingIds },
    });
    const normalized = normalizePortMappingBatchDeleteResult(response);
    consoleLogger.debug("port-mapping:batch-delete:success", { instanceId, succeeded: normalized.succeeded, failed: normalized.failed });
    return normalized;
  },

  /* ───────── 实例扩展操作 ───────── */

  /** 删除实例 */
  async deleteInstance(instanceId: string, token?: string): Promise<InstanceActionResult> {
    consoleLogger.debug("instance:delete:start", { instanceId });
    const response = await requestJson<any>(`/cecs/instances/${instanceId}`, { method: "DELETE", token });
    consoleLogger.info("instance:delete:success", { instanceId });
    return normalizeActionResult(instanceId, response, "实例删除请求已提交");
  },

  /** 续费实例 */
  async renewInstance(instanceId: string, input: RenewInstanceInput, token?: string): Promise<RenewInstanceResult> {
    consoleLogger.debug("instance:renew:start", { instanceId, duration: input.duration });
    const response = await requestJson<any>(`/cecs/instances/${instanceId}/renew`, {
      method: "POST", token, json: { duration: input.duration },
    });
    const body = unwrapApiPayload(response);
    consoleLogger.info("instance:renew:success", { instanceId });
    return {
      instanceId: String(body?.instance_id ?? body?.instanceId ?? instanceId),
      newExpireAt: String(body?.new_expire_at ?? body?.newExpireAt ?? ""),
      charged: Number(body?.charged ?? 0),
    };
  },

  /** 切换操作系统 */
  async switchOs(instanceId: string, input: SwitchOsInput, token?: string): Promise<SwitchOsResult> {
    consoleLogger.debug("instance:switch-os:start", { instanceId, systemId: input.systemId });
    const response = await requestJson<any>(`/cecs/instances/${instanceId}/switch-os`, {
      method: "POST", token, json: { system_id: input.systemId, password: input.password },
    });
    const body = unwrapApiPayload(response);
    consoleLogger.info("instance:switch-os:success", { instanceId });
    return {
      instanceId: String(body?.instance_id ?? body?.instanceId ?? instanceId),
      status: String(body?.status ?? "accepted"),
      message: String(body?.message ?? "系统切换请求已提交"),
    };
  },

  /** 获取实例操作日志 */
  async fetchOpLogs(instanceId: string, page = 1, pageSize = 20, token?: string): Promise<OpLogListResponse> {
    consoleLogger.debug("instance:op-logs:start", { instanceId, page, pageSize });
    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    const response = await requestJson<any>(
      `/console/instances/${instanceId}/op-logs?${query}`,
      { method: "GET", token },
    );
    const body = unwrapApiPayload(response);
    const list = Array.isArray(body?.list) ? body.list : Array.isArray(body?.items) ? body.items : [];
    consoleLogger.debug("instance:op-logs:loaded", { instanceId, count: list.length });
    return {
      total: Number(body?.total ?? list.length),
      items: list.map(normalizeOpLogEntry),
    };
  },

  /** 切换端口映射公网 IP */
  async switchPortMappingIp(instanceId: string, token?: string): Promise<SwitchIpResult> {
    consoleLogger.debug("port-mapping:switch-ip:start", { instanceId });
    const response = await requestJson<any>(`/cecs/instances/${instanceId}/port-mappings/switch-ip`, {
      method: "POST", token,
    });
    const body = unwrapApiPayload(response);
    consoleLogger.info("port-mapping:switch-ip:success", { instanceId, newIp: body?.new_ip });
    return {
      newIp: String(body?.new_ip ?? body?.newIp ?? ""),
      deleted: Number(body?.deleted ?? 0),
    };
  },

  /* ───────── 批量操作（前端并发调用） ───────── */

  /** 批量启动多台实例 */
  async batchStartInstances(instanceIds: string[], token?: string): Promise<BatchActionResult> {
    consoleLogger.info("batch:start:begin", { count: instanceIds.length });
    return executeBatch(instanceIds, (id) => consoleApi.startInstance(id, token));
  },

  /** 批量停止多台实例 */
  async batchStopInstances(instanceIds: string[], token?: string): Promise<BatchActionResult> {
    consoleLogger.info("batch:stop:begin", { count: instanceIds.length });
    return executeBatch(instanceIds, (id) => consoleApi.stopInstance(id, token));
  },

  /** 批量重启多台实例 */
  async batchRebootInstances(instanceIds: string[], token?: string): Promise<BatchActionResult> {
    consoleLogger.info("batch:reboot:begin", { count: instanceIds.length });
    return executeBatch(instanceIds, (id) => consoleApi.rebootInstance(id, token));
  },

  /* ───────── WebSocket 终端 ───────── */

  /** 构建 SSH WebSocket 连接 URL（支持传入公网地址和映射端口） */
  getSshWsUrl(instanceId: string, token: string, host?: string, port?: number): string {
    const base = getApiBaseUrl().replace(/^http/, "ws");
    let url = `${base}/instance/${instanceId}/ssh?token=${encodeURIComponent(token)}`;
    if (host) url += `&host=${encodeURIComponent(host)}`;
    if (port) url += `&port=${encodeURIComponent(String(port))}`;
    return url;
  },

  /** 构建串口 WebSocket 连接 URL */
  getSerialWsUrl(instanceId: string, token: string): string {
    const base = getApiBaseUrl().replace(/^http/, "ws");
    return `${base}/instance/${instanceId}/serial?token=${encodeURIComponent(token)}`;
  },

  /** 构建 VNC WebSocket 连接 URL（远程桌面） */
  getVncWsUrl(instanceId: string, token: string, host?: string, port?: number): string {
    const base = getApiBaseUrl().replace(/^http/, "ws");
    let url = `${base}/instance/${instanceId}/vnc?token=${encodeURIComponent(token)}`;
    if (host) url += `&host=${encodeURIComponent(host)}`;
    if (port) url += `&port=${encodeURIComponent(String(port))}`;
    return url;
  },

  /** 获取 VNC 截图 URL（REST 接口，返回 JPEG 图片） */
  getScreenshotUrl(instanceId: string, token: string, host: string, port: number, password?: string): string {
    const base = getApiBaseUrl();
    let url = `${base}/console/instances/${instanceId}/screenshot?host=${encodeURIComponent(host)}&port=${encodeURIComponent(String(port))}`;
    if (password) url += `&password=${encodeURIComponent(password)}`;
    // token 通过 Authorization header 传递，这里构造的是给 img src 用的 URL，需要带 token
    url += `&token=${encodeURIComponent(token)}`;
    return url;
  },

  /* ───────── 用户资料编辑 ───────── */

  /** 发送短信/邮箱验证码 */
  async sendVerificationCode(input: SendCodeInput): Promise<void> {
    const path = input.channel === "sms" ? "/auth/sms/send" : "/auth/email/send";
    const body = input.channel === "sms"
      ? { phone: input.target, scene: input.scene }
      : { email: input.target, scene: input.scene };
    consoleLogger.info("sendCode:start", { channel: input.channel, scene: input.scene });
    await requestJson(path, { method: "POST", json: body });
    consoleLogger.info("sendCode:ok", { channel: input.channel });
  },

  /** 绑定/换绑手机号 */
  async bindPhone(input: BindPhoneInput, token?: string): Promise<void> {
    consoleLogger.info("bindPhone:start", { phone: input.phone });
    await requestJson("/user/bind/phone", {
      method: "POST",
      token,
      json: { phone: input.phone, code: input.code },
    });
    consoleLogger.info("bindPhone:ok");
  },

  /** 绑定/换绑邮箱 */
  async bindEmail(input: BindEmailInput, token?: string): Promise<void> {
    consoleLogger.info("bindEmail:start", { email: input.email });
    await requestJson("/user/bind/email", {
      method: "POST",
      token,
      json: { email: input.email, code: input.code },
    });
    consoleLogger.info("bindEmail:ok");
  },

  /** 修改密码 */
  async changePassword(input: ChangePasswordInput, token?: string): Promise<void> {
    consoleLogger.info("changePassword:start");
    await requestJson("/user/change/password", {
      method: "POST",
      token,
      json: {
        old_password: input.oldPassword ?? "",
        new_password: input.newPassword,
        confirm_password: input.confirmPassword,
      },
    });
    consoleLogger.info("changePassword:ok");
  },

  /* ───────── SharedStorage 文件管理 ───────── */

  /** 获取用户的共享存储实例列表 */
  async fetchStorageInstances(token?: string): Promise<StorageInstanceListResponse> {
    consoleLogger.debug("storage:instances:start");
    const response = await requestJson<any>("/console/storage/instances", { method: "GET", token });
    const body = unwrapApiPayload(response);
    consoleLogger.debug("storage:instances:loaded", { count: body?.instances?.length });
    return normalizeStorageInstanceList(body);
  },

  /** 获取存储空间概览 */
  async fetchStorageOverview(instanceId: string, token?: string): Promise<StorageOverview> {
    consoleLogger.debug("storage:overview:start", { instanceId });
    const response = await requestJson<any>(`/console/instances/${instanceId}/storage/overview`, { method: "GET", token });
    const body = unwrapApiPayload(response);
    consoleLogger.debug("storage:overview:loaded", { instanceId });
    return normalizeStorageOverview(body, instanceId);
  },

  /** 列出存储文件列表 */
  async fetchStorageFiles(instanceId: string, prefix?: string, page = 1, pageSize = 50, token?: string): Promise<StorageFileListResponse> {
    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (prefix) {
      query.set("prefix", prefix);
    }
    consoleLogger.debug("storage:files:start", { instanceId, prefix });
    const response = await requestJson<any>(`/console/instances/${instanceId}/storage/files?${query}`, { method: "GET", token });
    const body = unwrapApiPayload(response);
    consoleLogger.debug("storage:files:loaded", { instanceId });
    return normalizeStorageFileList(body);
  },

  /** 创建文件夹 */
  async createStorageFolder(instanceId: string, input: StorageCreateFolderInput, token?: string): Promise<StorageCreateFolderResult> {
    consoleLogger.info("storage:folder:create:start", { instanceId, path: input.path });
    const response = await requestJson<any>(`/console/instances/${instanceId}/storage/folders`, {
      method: "POST",
      token,
      json: { path: input.path },
    });
    const body = unwrapApiPayload(response);
    consoleLogger.info("storage:folder:create:ok", { instanceId, path: input.path });
    return {
      path: String(body?.path ?? input.path),
      success: body?.success !== false,
    };
  },

  /** 删除文件或文件夹 */
  async deleteStorageFile(instanceId: string, key: string, token?: string): Promise<StorageDeleteResult> {
    consoleLogger.info("storage:file:delete:start", { instanceId, key });
    const response = await requestJson<any>(`/console/instances/${instanceId}/storage/files/${key}`, { method: "DELETE", token });
    const body = unwrapApiPayload(response);
    consoleLogger.info("storage:file:delete:ok", { instanceId, key });
    return {
      key: String(body?.key ?? key),
      success: body?.success !== false,
    };
  },

  /** 获取文件上传 URL（PUT 流式上传） */
  getUploadUrl(instanceId: string, key: string): string {
    const base = getApiBaseUrl();
    return `${base}/console/instances/${instanceId}/storage/upload/${key}`;
  },

  /** 获取文件下载 URL（GET 流式下载） */
  getDownloadUrl(instanceId: string, key: string): string {
    const base = getApiBaseUrl();
    return `${base}/console/instances/${instanceId}/storage/download/${key}`;
  },

  /** 上传文件到存储空间 */
  async uploadStorageFile(instanceId: string, key: string, file: File, token?: string): Promise<void> {
    const url = consoleApi.getUploadUrl(instanceId, key);
    consoleLogger.info("storage:upload:start", { instanceId, key, size: file.size });

    const headers: Record<string, string> = {
      "Content-Type": file.type || "application/octet-stream",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: file,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "上传失败");
      consoleLogger.warn("storage:upload:failed", { instanceId, key, status: response.status });
      throw new ApiError("http", text, response.status);
    }
    consoleLogger.info("storage:upload:ok", { instanceId, key });
  },
};

// ───────── Storage 标准化函数 ─────────

/** 标准化存储实例列表响应 */
function normalizeStorageInstanceList(payload: any): StorageInstanceListResponse {
  const items = Array.isArray(payload?.instances) ? payload.instances : [];
  return {
    totalGb: Number(payload?.total_gb ?? 0),
    usedGb: Number(payload?.used_gb ?? 0),
    availableGb: Number(payload?.available_gb ?? 0),
    usagePercent: Number(payload?.usage_percent ?? 0),
    packageCount: Number(payload?.package_count ?? 0),
    instanceCount: Number(payload?.instance_count ?? items.length),
    instances: items.map((item: any): StorageInstance => ({
      instanceId: String(item?.instance_id ?? ""),
      displayName: String(item?.display_name ?? item?.instance_id ?? ""),
      capacityGb: Number(item?.capacity_gb ?? 0),
      usedPercent: Number(item?.used_percent ?? 0),
      accessMode: String(item?.access_mode ?? "private"),
    })),
  };
}

/** 标准化存储空间概览 */
function normalizeStorageOverview(payload: any, instanceId: string): StorageOverview {
  return {
    instanceId: String(payload?.instance_id ?? payload?.instanceId ?? instanceId),
    totalSize: Number(payload?.total_size ?? payload?.totalSize ?? 0),
    usedSize: Number(payload?.used_size ?? payload?.usedSize ?? 0),
    fileCount: Number(payload?.file_count ?? payload?.fileCount ?? 0),
    folderCount: Number(payload?.folder_count ?? payload?.folderCount ?? 0),
  };
}

/** 标准化单个文件条目 */
function normalizeStorageFileItem(payload: any): StorageFileItem {
  return {
    key: String(payload?.key ?? ""),
    name: String(payload?.name ?? ""),
    size: Number(payload?.size ?? 0),
    isDir: Boolean(payload?.is_dir ?? payload?.isDir ?? false),
    contentType: String(payload?.content_type ?? payload?.contentType ?? ""),
    lastModified: String(payload?.last_modified ?? payload?.lastModified ?? ""),
  };
}

/** 标准化文件列表响应 */
function normalizeStorageFileList(payload: any): StorageFileListResponse {
  const items = Array.isArray(payload?.list) ? payload.list : Array.isArray(payload?.items) ? payload.items : [];
  return {
    total: Number(payload?.total ?? items.length),
    items: items.map(normalizeStorageFileItem),
  };
}

function normalizeActionResult(instanceId: string, payload: any, fallbackMessage: string): InstanceActionResult {
  const body = unwrapApiPayload(payload);
  // 操作响应字段在不同上游接口中可能有差异，在此统一标准化。
  return {
    instanceId: String(body?.instance_id ?? body?.instanceId ?? instanceId),
    status: String(body?.status ?? body?.state ?? "accepted"),
    message: String(body?.message ?? body?.detail ?? fallbackMessage),
  };
}

/** 标准化单条操作日志 */
function normalizeOpLogEntry(payload: any): OpLogEntry {
  return {
    logId: String(payload?.id ?? payload?.log_id ?? payload?.logId ?? ""),
    action: String(payload?.op_type ?? payload?.action ?? payload?.operation ?? ""),
    status: String(payload?.status ?? ""),
    operator: payload?.operator ? String(payload.operator) : payload?.username ? String(payload.username) : undefined,
    detail: payload?.op_desc
      ? String(payload.op_desc)
      : payload?.detail
        ? String(payload.detail)
        : payload?.err_msg
          ? String(payload.err_msg)
          : undefined,
    createdAt: String(payload?.created_at ?? payload?.createdAt ?? ""),
  };
}

/**
 * 顺序执行批量操作，每次操作之间添加延时以避免上游 429 限流。
 * 使用 try/catch 确保部分失败不影响其他设备。
 */
async function executeBatch(
  instanceIds: string[],
  action: (id: string) => Promise<InstanceActionResult>,
): Promise<BatchActionResult> {
  const items: { instanceId: string; success: boolean; message: string }[] = [];
  // 请求间延迟（毫秒），避免触发上游速率限制
  const DELAY_MS = 500;

  for (let i = 0; i < instanceIds.length; i++) {
    // 非首次请求时等待一段时间，防止触发上游限流
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    try {
      const result = await action(instanceIds[i]);
      items.push({ instanceId: instanceIds[i], success: true, message: result.message });
    } catch (err: any) {
      items.push({ instanceId: instanceIds[i], success: false, message: err?.message ?? "操作失败" });
    }
  }

  const succeeded = items.filter((i) => i.success).length;
  consoleLogger.info("batch:complete", { total: items.length, succeeded, failed: items.length - succeeded });
  return { total: items.length, succeeded, failed: items.length - succeeded, items };
}

export const consoleApiTestUtils = {
  normalizeActionResult,
  normalizeDetail,
  normalizeInstance,
  normalizeSession,
  normalizePortMappingBatchCreateResult,
  normalizePortMappingBatchDeleteResult,
  normalizePortMappingDeleteResult,
  normalizePortMappingList,
  normalizePortMappingOverview,
};
