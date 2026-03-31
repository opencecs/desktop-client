export type AppDataSource = "api";

export type InstanceStatus = "running" | "stopped" | "expired" | "pending" | string;

export interface CurrentUser {
  userId: string;
  username: string;
  phone?: string;
  email?: string;
  avatar?: string;
  role?: string;
  userType?: string;
  isVerified?: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  expireTime?: number;
  source: AppDataSource;
  user: CurrentUser;
}

export interface LoginInput {
  username: string;
  password: string;
  rememberMe: boolean;
}

export interface InstanceSummary {
  instanceId: string;
  instanceName: string;
  boardType: string;
  boardName?: string;
  imageName?: string;
  ipAddress: string;
  status: InstanceStatus;
  billingMode: string;
  expireAt: string;
  createdAt: string;
  regionName?: string;
  monthlyPrice?: string;
  memory?: number;
  diskSize?: number;
  bandwidth?: number;
  bandwidthType?: string;
  isDesktop?: boolean;
  isDesktopSystem: boolean;
  osName?: string;
  desktopEnv?: string;
  desktopStatus?: string;
  networkStatus?: string;
}

export interface InstanceDetail extends InstanceSummary {
  macAddress?: string;
  updatedAt?: string;
  orderId?: string;
  consoleUrl?: string;
  description?: string;
}

export interface PortMappingStats {
  used: number;
  quota: number;
  activeCount: number;
  failedCount: number;
}

export interface PortMappingOverview {
  instanceId: string;
  instanceName?: string;
  privateIp?: string;
  natPublicIp?: string;
  tcp: PortMappingStats;
  udp: PortMappingStats;
}

export interface PortMappingRule {
  mappingId: string;
  protocol: string;
  publicPort: number;
  privatePort: number;
  remark?: string;
  proxyStatus?: string;
  failReason?: string;
  createdAt?: string;
}

export interface PortMappingListResponse {
  total: number;
  items: PortMappingRule[];
}

export interface PortMappingCreateInput {
  protocol: string;
  privatePort: number;
  remark?: string;
}

export interface PortMappingUpdateInput {
  privatePort?: number;
  remark?: string;
}

export interface PortMappingBatchCreateItem extends PortMappingCreateInput {}

export interface PortMappingBatchCreateInput {
  rules: PortMappingBatchCreateItem[];
}

export interface PortMappingBatchCreateResultItem {
  index: number;
  success: boolean;
  data?: PortMappingRule;
  reason?: string;
}

export interface PortMappingBatchCreateResult {
  total: number;
  succeeded: number;
  failed: number;
  results: PortMappingBatchCreateResultItem[];
}

// Keep batch-delete results separate because the upstream does not return `index`.

export interface PortMappingBatchDeleteResultItem {
  mappingId: string;
  success: boolean;
  reason?: string;
}

export interface PortMappingBatchDeleteResult {
  total: number;
  succeeded: number;
  failed: number;
  results: PortMappingBatchDeleteResultItem[];
}

export interface PortMappingDeleteResult {
  mappingId: string;
  success: boolean;
  message: string;
}

export interface DashboardResponse {
  source: AppDataSource;
  total: number;
  items: InstanceSummary[];
  stats?: {
    total: number;
    desktop: number;
    running: number;
    stopped: number;
    expired: number;
  };
}

export interface InstanceActionResult {
  instanceId: string;
  status: string;
  message: string;
}

export interface ConsoleLinkResult {
  instanceId: string;
  consoleUrl: string;
  expiresAt?: string;
}

/* ───────── 操作日志 ───────── */

/** 单条实例操作日志 */
export interface OpLogEntry {
  logId: string;
  action: string;
  status: string;
  operator?: string;
  detail?: string;
  createdAt: string;
}

/** 操作日志列表响应 */
export interface OpLogListResponse {
  total: number;
  items: OpLogEntry[];
}

/* ───────── 实例扩展操作 ───────── */

/** 续费请求参数 */
export interface RenewInstanceInput {
  duration: number;
}

/** 续费响应 */
export interface RenewInstanceResult {
  instanceId: string;
  newExpireAt: string;
  charged: number;
}

/** 切换系统请求参数 */
export interface SwitchOsInput {
  systemId: string;
  password?: string;
}

/** 切换系统响应 */
export interface SwitchOsResult {
  instanceId: string;
  status: string;
  message: string;
}

/** 切换端口映射公网 IP 响应 */
export interface SwitchIpResult {
  newIp: string;
  deleted: number;
}

/* ───────── 批量操作 ───────── */

/** 批量操作单项结果 */
export interface BatchActionItem {
  instanceId: string;
  success: boolean;
  message: string;
}

/** 批量操作总结果 */
export interface BatchActionResult {
  total: number;
  succeeded: number;
  failed: number;
  items: BatchActionItem[];
}

/* ───────── 用户资料编辑 ───────── */

/** 绑定/换绑手机号请求 */
export interface BindPhoneInput {
  phone: string;
  code: string;
}

/** 绑定/换绑邮箱请求 */
export interface BindEmailInput {
  email: string;
  code: string;
}

/** 修改密码请求 */
export interface ChangePasswordInput {
  oldPassword?: string;
  newPassword: string;
  confirmPassword: string;
}

/** 发送验证码请求 */
export interface SendCodeInput {
  /** 手机号或邮箱 */
  target: string;
  /** sms | email */
  channel: "sms" | "email";
  /** 验证码用途场景 */
  scene: string;
}

/* ───────── SharedStorage 文件管理 ───────── */

/** 存储空间概览 */
export interface StorageOverview {
  instanceId: string;
  totalSize: number;   // 总容量（字节）
  usedSize: number;    // 已使用（字节）
  fileCount: number;   // 文件数量
  folderCount: number; // 文件夹数量
}

/** 文件/文件夹条目 */
export interface StorageFileItem {
  key: string;          // 文件路径/键名
  name: string;         // 文件名
  size: number;         // 文件大小（字节）
  isDir: boolean;       // 是否为目录
  contentType: string;  // MIME 类型
  lastModified: string; // 最后修改时间
}

/** 文件列表响应 */
export interface StorageFileListResponse {
  total: number;
  items: StorageFileItem[];
}

/** 创建文件夹请求 */
export interface StorageCreateFolderInput {
  path: string;
}

/** 创建文件夹响应 */
export interface StorageCreateFolderResult {
  path: string;
  success: boolean;
}

/** 删除文件响应 */
export interface StorageDeleteResult {
  key: string;
  success: boolean;
}

/** 共享存储实例简要信息 */
export interface StorageInstance {
  instanceId: string;
  displayName: string;
  capacityGb: number;
  usedPercent: number;
  accessMode: string;
}

/** 共享存储实例列表响应 */
export interface StorageInstanceListResponse {
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usagePercent: number;
  packageCount: number;
  instanceCount: number;
  instances: StorageInstance[];
}
