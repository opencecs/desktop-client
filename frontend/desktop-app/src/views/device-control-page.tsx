/**
 * 群控设备面板 — 多设备网格视图，支持多选与批量操作
 * 核心功能：设备列表、多选框、批量开机/关机/重启、群控终端、批量文件推送、投屏画面墙
 */
import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";
import { useAuthStore } from "@/stores/auth-store";
import { openExternal } from "@/lib/open-external";
import { useDeviceGroupsStore, type DeviceGroup } from "@/stores/device-groups-store";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { StatusPill } from "@/components/StatusPill";
import type { InstanceSummary, BatchActionResult, PortMappingRule } from "@/types";

/** 可执行的批量动作类型 */
type BatchAction = "start" | "stop" | "reboot";

/** 批量动作的标签映射 */
const ACTION_LABELS: Record<BatchAction, string> = {
  start: "批量开机",
  stop: "批量关机",
  reboot: "批量重启",
};

/** 定时任务 */
interface ScheduledTask {
  id: string;
  action: BatchAction;
  instanceIds: string[];
  scheduledAt: string;
  status: "pending" | "running" | "done" | "failed";
}

/**
 * 群控设备面板主页面
 * 展示所有设备的网格卡片，提供多选与批量操作能力
 */
export function DeviceControlPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.session?.accessToken);

  // ── 设备列表查询（每 10 秒自动刷新，保证实例状态及时更新） ──
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => consoleApi.fetchDashboard(token),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  // ── 多选状态 ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchResult, setBatchResult] = useState<BatchActionResult | null>(null);
  const [alertMsg, setAlertMsg] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");

  const instances = data?.items ?? [];

  // 搜索过滤
  const filteredInstances = useMemo(() => {
    if (!searchKeyword.trim()) return instances;
    const kw = searchKeyword.toLowerCase();
    return instances.filter((inst) =>
      [inst.instanceId, inst.instanceName, inst.ipAddress, inst.boardType, inst.osName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(kw)
    );
  }, [instances, searchKeyword]);

  /** 切换单台设备选中状态 */
  const toggleSelect = useCallback((id: string) => {
    console.log("[DeviceControl] 切换选中设备:", id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** 全选 / 取消全选 */
  const toggleAll = useCallback(() => {
    if (selectedIds.size === filteredInstances.length) {
      console.log("[DeviceControl] 取消全选");
      setSelectedIds(new Set());
    } else {
      console.log("[DeviceControl] 全选所有设备");
      setSelectedIds(new Set(filteredInstances.map((i) => i.instanceId)));
    }
  }, [selectedIds.size, filteredInstances]);

  const isAllSelected = filteredInstances.length > 0 && selectedIds.size === filteredInstances.length;

  // ── 批量操作变更 ──
  const batchMutation = useMutation({
    mutationFn: async ({ action, ids }: { action: BatchAction; ids: string[] }) => {
      console.log(`[DeviceControl] 执行批量操作: ${action}, 设备数: ${ids.length}`);
      if (action === "start") return consoleApi.batchStartInstances(ids, token);
      if (action === "stop") return consoleApi.batchStopInstances(ids, token);
      return consoleApi.batchRebootInstances(ids, token);
    },
    onSuccess: (result, { action }) => {
      console.log(`[DeviceControl] 批量${action}完成: 成功${result.succeeded} 失败${result.failed}`);
      setBatchResult(result);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      console.error("[DeviceControl] 批量操作失败:", err);
      setAlertMsg(err instanceof Error ? err.message : "批量操作失败");
    },
  });

  /** 执行批量操作 */
  const runBatch = useCallback((action: BatchAction) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setAlertMsg("请先选择至少一台设备");
      return;
    }
    batchMutation.mutate({ action, ids });
  }, [selectedIds, batchMutation]);

  // ── 设备分组管理 ──
  const { groups, createGroup, deleteGroup } = useDeviceGroupsStore();
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  /** 从选中设备创建分组 */
  const handleCreateGroup = useCallback(() => {
    if (!newGroupName.trim() || selectedIds.size === 0) return;
    console.log("[DeviceControl] 创建设备分组:", newGroupName, Array.from(selectedIds));
    createGroup(newGroupName.trim(), Array.from(selectedIds));
    setNewGroupName("");
    setShowGroupModal(false);
  }, [newGroupName, selectedIds, createGroup]);

  /** 使用分组快速选中设备 */
  const selectGroup = useCallback((group: DeviceGroup) => {
    console.log("[DeviceControl] 选中分组:", group.name, group.instanceIds);
    setSelectedIds(new Set(group.instanceIds));
  }, []);

  /** 端口映射展开状态 */
  const [expandedPortMapping, setExpandedPortMapping] = useState<string | null>(null);

  /** 批量文件推送结果状态 */
  const [filePushResult, setFilePushResult] = useState<string>("");

  /** 定时任务状态 */
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>(() => {
    try {
      const raw = localStorage.getItem("dcc.scheduledTasks");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleAction, setScheduleAction] = useState<BatchAction>("start");
  const [scheduleTime, setScheduleTime] = useState("");
  const taskTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 持久化定时任务
  useEffect(() => {
    localStorage.setItem("dcc.scheduledTasks", JSON.stringify(scheduledTasks));
  }, [scheduledTasks]);

  // 启动所有 pending 任务的定时器
  useEffect(() => {
    scheduledTasks.forEach((task) => {
      if (task.status !== "pending" || taskTimers.current.has(task.id)) return;
      const delay = new Date(task.scheduledAt).getTime() - Date.now();
      if (delay <= 0) {
        // 已过时间，立即执行
        executeScheduledTask(task);
        return;
      }
      const timer = setTimeout(() => executeScheduledTask(task), delay);
      taskTimers.current.set(task.id, timer);
    });
    return () => {
      taskTimers.current.forEach((t) => clearTimeout(t));
      taskTimers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledTasks]);

  /** 执行定时任务 */
  const executeScheduledTask = useCallback(async (task: ScheduledTask) => {
    setScheduledTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: "running" as const } : t));
    try {
      if (task.action === "start") await consoleApi.batchStartInstances(task.instanceIds, token);
      else if (task.action === "stop") await consoleApi.batchStopInstances(task.instanceIds, token);
      else await consoleApi.batchRebootInstances(task.instanceIds, token);
      setScheduledTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: "done" as const } : t));
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      console.error(`[DeviceControl] 定时任务执行失败: ${task.id} (${task.action})`, err);
      setScheduledTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: "failed" as const } : t));
    }
    taskTimers.current.delete(task.id);
  }, [token, queryClient]);

  /** 创建定时任务 */
  const handleCreateSchedule = useCallback(() => {
    if (!scheduleTime || selectedIds.size === 0) return;
    const parsedDate = new Date(scheduleTime);
    if (isNaN(parsedDate.getTime())) { setAlertMsg("无效的日期时间"); return; }
    if (parsedDate.getTime() <= Date.now()) { setAlertMsg("请选择未来的时间"); return; }
    const task: ScheduledTask = {
      id: `task-${Date.now()}`,
      action: scheduleAction,
      instanceIds: Array.from(selectedIds),
      scheduledAt: parsedDate.toISOString(),
      status: "pending",
    };
    setScheduledTasks((prev) => [...prev, task]);
    setShowScheduleModal(false);
    setScheduleTime("");
    setAlertMsg(`定时任务已创建：${ACTION_LABELS[scheduleAction]} ${task.instanceIds.length} 台设备，时间 ${new Date(task.scheduledAt).toLocaleString()}`);
  }, [scheduleTime, scheduleAction, selectedIds]);

  /** 取消定时任务 */
  const cancelScheduledTask = useCallback((id: string) => {
    const timer = taskTimers.current.get(id);
    if (timer) { clearTimeout(timer); taskTimers.current.delete(id); }
    setScheduledTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** 批量文件推送 — 选择文件后推送到所有选中设备 */
  const handleBatchFilePush = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setAlertMsg("请先选择至少一台设备");
      return;
    }

    // 使用原生文件选择器
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;

    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;

      console.log("[DeviceControl] 批量文件推送:", { fileCount: files.length, deviceCount: ids.length });
      setFilePushResult(`正在推送 ${files.length} 个文件到 ${ids.length} 台设备...`);

      let successCount = 0;
      let failCount = 0;

      for (const file of Array.from(files)) {
        for (const instanceId of ids) {
          try {
            await consoleApi.uploadStorageFile(instanceId, `/${file.name}`, file, token);
            successCount++;
          } catch (err) {
            console.error(`[DeviceControl] 文件推送失败: ${file.name} → ${instanceId}`, err);
            failCount++;
          }
        }
      }

      const resultMsg = `文件推送完成：成功 ${successCount} 次，失败 ${failCount} 次`;
      console.log("[DeviceControl]", resultMsg);
      setFilePushResult(resultMsg);
    };

    input.click();
  }, [selectedIds, token]);

  /** 按状态分组的统计信息 */
  const statusStats = useMemo(() => {
    const stats = { running: 0, stopped: 0, expired: 0, other: 0 };
    for (const inst of instances) {
      if (inst.status === "running") stats.running++;
      else if (inst.status === "stopped") stats.stopped++;
      else if (inst.status === "expired") stats.expired++;
      else stats.other++;
    }
    return stats;
  }, [instances]);

  // ── 加载状态 ──
  if (isLoading) {
    return <div className="page-loading"><LoadingSpinner label="加载设备列表..." /></div>;
  }

  if (error) {
    const isNetworkError = error instanceof Error && (
      error.message.includes("fetch") || error.message.includes("network") ||
      error.message.includes("ECONNREFUSED") || error.message.includes("Failed") ||
      error.message.includes("timeout") || error.message.includes("aborted")
    );
    return (
      <div className="page-error-state">
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ opacity: 0.3 }}>
          <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
          <path d="M20 28h16M28 20v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        </svg>
        <h3>{isNetworkError ? "无法连接到服务器" : "加载设备列表失败"}</h3>
        <p>
          {isNetworkError
            ? "请检查后端服务是否已启动，以及网络连接是否正常"
            : (error instanceof Error ? error.message : "发生未知错误，请稍后重试")}
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          重新加载
        </Button>
      </div>
    );
  }

  return (
    <div className="device-control-page">
      {/* 顶栏：统计 + 搜索 */}
      <div className="dc-header">
        <div className="dc-stats-bar">
          <div className="dc-stats-item">
            <span className="dc-stats-count">{instances.length}</span>
            <span className="dc-stats-label">全部</span>
          </div>
          <div className="dc-stats-item dc-stats-running">
            <span className="dc-stats-count">{statusStats.running}</span>
            <span className="dc-stats-label">运行中</span>
          </div>
          <div className="dc-stats-item dc-stats-stopped">
            <span className="dc-stats-count">{statusStats.stopped}</span>
            <span className="dc-stats-label">已停机</span>
          </div>
          {statusStats.expired > 0 && (
            <div className="dc-stats-item dc-stats-expired">
              <span className="dc-stats-count">{statusStats.expired}</span>
              <span className="dc-stats-label">已过期</span>
            </div>
          )}
        </div>
        <input
          className="dc-search"
          type="text"
          placeholder="搜索设备名称、ID、IP..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
        />
      </div>

      {/* 批量操作工具栏 */}
      <div className="dc-toolbar">
        <div className="dc-toolbar-left">
          <label className="dc-select-all">
            <input type="checkbox" checked={isAllSelected} onChange={toggleAll} />
            <span>全选 ({selectedIds.size}/{filteredInstances.length})</span>
          </label>
          {/* 分组快速选择 */}
          {groups.length > 0 && (
            <div className="dc-groups-inline">
              {groups.map((g) => (
                <button
                  key={g.id}
                  className="dc-group-chip"
                  onClick={() => selectGroup(g)}
                  title={`${g.name} (${g.instanceIds.length} 台)`}
                >
                  {g.name}
                  <span className="dc-group-delete" onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}>×</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dc-toolbar-actions">
          {(["start", "stop", "reboot"] as BatchAction[]).map((action) => (
            <Button
              key={action}
              variant={action === "stop" ? "danger" : "primary"}
              onClick={() => runBatch(action)}
              disabled={selectedIds.size === 0 || batchMutation.isPending}
              loading={batchMutation.isPending}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
          <Button
            variant="ghost"
            onClick={() => {
              if (selectedIds.size === 0) return;
              navigate(`/webrtc-screen-wall?ids=${Array.from(selectedIds).join(",")}`);
            }}
            disabled={selectedIds.size === 0}
          >
            投屏/群控
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (selectedIds.size === 0) return;
              navigate(`/screen-wall?ids=${Array.from(selectedIds).join(",")}`);
            }}
            disabled={selectedIds.size === 0}
          >
            VNC投屏
          </Button>
          <Button variant="ghost" onClick={() => setShowScheduleModal(true)} disabled={selectedIds.size === 0}>
            定时任务
          </Button>
          <Button variant="ghost" onClick={() => setShowGroupModal(true)} disabled={selectedIds.size === 0}>
            存为分组
          </Button>
        </div>
      </div>

      {/* 提示消息 */}
      {alertMsg && <Alert type="error" message={alertMsg} dismissible onDismiss={() => setAlertMsg("")} />}
      {batchResult && (
        <Alert
          type={batchResult.failed === 0 ? "success" : "error"}
          message={`操作完成：成功 ${batchResult.succeeded} 台，失败 ${batchResult.failed} 台`}
          dismissible
          onDismiss={() => setBatchResult(null)}
        />
      )}
      {filePushResult && (
        <Alert
          type={filePushResult.includes("失败 0") || !filePushResult.includes("失败") ? "success" : "error"}
          message={filePushResult}
          dismissible
          onDismiss={() => setFilePushResult("")}
        />
      )}

      {/* 创建分组弹窗 */}
      {showGroupModal && (
        <div className="dc-modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>保存为设备分组</h3>
            <p>将选中的 {selectedIds.size} 台设备保存为分组</p>
            <input
              type="text"
              placeholder="输入分组名称..."
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }}
              className="dc-modal-input"
              autoFocus
            />
            <div className="dc-modal-actions">
              <Button variant="ghost" onClick={() => setShowGroupModal(false)}>取消</Button>
              <Button variant="primary" onClick={handleCreateGroup} disabled={!newGroupName.trim()}>保存</Button>
            </div>
          </div>
        </div>
      )}

      {/* 定时任务弹窗 */}
      {showScheduleModal && (
        <div className="dc-modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>创建定时任务</h3>
            <p>对选中的 {selectedIds.size} 台设备定时执行操作</p>
            <div className="dc-schedule-form">
              <label className="dc-schedule-label">
                操作类型
                <select value={scheduleAction} onChange={(e) => setScheduleAction(e.target.value as BatchAction)} className="dc-modal-input">
                  <option value="start">开机</option>
                  <option value="stop">关机</option>
                  <option value="reboot">重启</option>
                </select>
              </label>
              <label className="dc-schedule-label">
                执行时间
                <input
                  type="datetime-local"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="dc-modal-input"
                />
              </label>
            </div>
            <div className="dc-modal-actions">
              <Button variant="ghost" onClick={() => setShowScheduleModal(false)}>取消</Button>
              <Button variant="primary" onClick={handleCreateSchedule} disabled={!scheduleTime}>创建</Button>
            </div>
          </div>
        </div>
      )}

      {/* 定时任务列表 */}
      {scheduledTasks.length > 0 && (
        <div className="dc-schedule-list">
          <div className="dc-schedule-list-title">定时任务</div>
          {scheduledTasks.map((task) => (
            <div key={task.id} className={`dc-schedule-item dc-schedule-${task.status}`}>
              <span className="dc-schedule-action">{ACTION_LABELS[task.action]}</span>
              <span className="dc-schedule-count">{task.instanceIds.length} 台</span>
              <span className="dc-schedule-time">{new Date(task.scheduledAt).toLocaleString()}</span>
              <span className={`dc-schedule-status`}>
                {task.status === "pending" ? "等待中" : task.status === "running" ? "执行中" : task.status === "done" ? "已完成" : "失败"}
              </span>
              {task.status === "pending" && (
                <button className="dc-schedule-cancel" onClick={() => cancelScheduledTask(task.id)}>取消</button>
              )}
              {(task.status === "done" || task.status === "failed") && (
                <button className="dc-schedule-cancel" onClick={() => cancelScheduledTask(task.id)}>移除</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 设备网格 */}
      {filteredInstances.length === 0 ? (
        <div className="dc-empty">
          {instances.length === 0 ? (
            <>
              <p>暂无设备</p>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8 }}>
                前往{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    const url = token
                      ? `https://www.opencecs.com/console?access_token=${encodeURIComponent(token)}`
                      : "https://www.opencecs.com/console";
                    openExternal(url);
                  }}
                  style={{ color: "var(--accent, #6366f1)", textDecoration: "underline", cursor: "pointer" }}
                >
                  www.opencecs.com
                </a>{" "}
                购买云端实例
              </p>
            </>
          ) : (
            "没有匹配的设备"
          )}
        </div>
      ) : (
        <div className="dc-device-grid">
          {filteredInstances.map((inst) => (
            <DeviceCard
              key={inst.instanceId}
              instance={inst}
              selected={selectedIds.has(inst.instanceId)}
              onToggle={() => toggleSelect(inst.instanceId)}
              onNavigate={() => navigate(`/instances/${inst.instanceId}`)}
              onTerminal={() => navigate(`/terminal/${inst.instanceId}`)}
              onDesktop={() => navigate(`/webrtc-screen-wall?ids=${inst.instanceId}`)}
              onFiles={() => navigate(`/files/${inst.instanceId}`)}
              portMappingExpanded={expandedPortMapping === inst.instanceId}
              onPortMapping={() => setExpandedPortMapping((prev) => prev === inst.instanceId ? null : inst.instanceId)}
              token={token}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────── 设备卡片组件 ───────── */

interface DeviceCardProps {
  instance: InstanceSummary;
  selected: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onTerminal: () => void;
  onDesktop: () => void;
  onFiles: () => void;
  portMappingExpanded: boolean;
  onPortMapping: () => void;
  token?: string;
}

/**
 * 单台设备卡片 — 展示设备基础信息及快捷操作
 */
function DeviceCard({ instance, selected, onToggle, onNavigate, onTerminal, onDesktop, onFiles, portMappingExpanded, onPortMapping, token }: DeviceCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 查询端口映射
  const { data: pmOverview } = useQuery({
    queryKey: ["pm-overview", instance.instanceId],
    queryFn: () => consoleApi.fetchPortMappingOverview(instance.instanceId, token),
    enabled: !!token && instance.status === "running",
    staleTime: 60_000,
  });
  const { data: pmList, isSuccess: pmListReady } = useQuery({
    queryKey: ["pm-list", instance.instanceId],
    queryFn: () => consoleApi.fetchPortMappings(instance.instanceId, token),
    enabled: !!token && instance.status === "running",
    staleTime: 60_000,
  });

  const natIp = pmOverview?.natPublicIp;

  // 需要自动创建的端口列表：22(SSH)、5900(VNC)、8077(WebRTC/截图)
  const REQUIRED_PORTS = useMemo(() => [
    { privatePort: 22, remark: "SSH" },
    { privatePort: 5900, remark: "VNC" },
    { privatePort: 8077, remark: "WebRTC投屏" },
  ], []);

  // 自动创建缺失的端口映射
  const autoCreatingRef = useRef(false);
  useEffect(() => {
    if (!pmListReady || !token || autoCreatingRef.current) return;
    const existing = pmList?.items ?? [];
    const missing = REQUIRED_PORTS.filter(
      (req) => !existing.some((r: PortMappingRule) => r.privatePort === req.privatePort && r.protocol.toUpperCase() === "TCP"),
    );
    if (missing.length === 0) return;

    autoCreatingRef.current = true;
    consoleApi
      .batchCreatePortMappings(
        instance.instanceId,
        { rules: missing.map((m) => ({ protocol: "tcp", privatePort: m.privatePort, remark: m.remark })) },
        token,
      )
      .catch(() => {})
      .finally(() => {
        autoCreatingRef.current = false;
        queryClient.invalidateQueries({ queryKey: ["pm-list", instance.instanceId] });
        queryClient.invalidateQueries({ queryKey: ["pm-overview", instance.instanceId] });
      });
  }, [pmListReady, pmList, token, instance.instanceId, REQUIRED_PORTS, queryClient]);

  // 找到 8077 端口映射用于截图
  const webrtcMapping = pmList?.items?.find(
    (r: PortMappingRule) => r.privatePort === 8077 && r.protocol.toUpperCase() === "TCP",
  );

  // 通过 debian_screen_control 的截图接口获取设备画面
  const canScreenshot = !!natIp && !!webrtcMapping;
  const [screenshotTs, setScreenshotTs] = useState(0);
  useEffect(() => {
    if (!canScreenshot) return;
    setScreenshotTs(Date.now());
    const timer = setInterval(() => setScreenshotTs(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [canScreenshot]);

  const screenshotUrl = (canScreenshot && screenshotTs)
    ? `http://${natIp}:${webrtcMapping!.publicPort}/screen/snapshot?token=123456&_t=${screenshotTs}`
    : "";

  const [imgError, setImgError] = useState(false);
  // 当 screenshotUrl 变化时重置错误状态
  useEffect(() => { setImgError(false); }, [screenshotUrl]);

  return (
    <div className={`dc-card ${selected ? "dc-card-selected" : ""} ${portMappingExpanded ? "dc-card-expanded" : ""}`}>
      {/* 设备截图预览 — 点击进入 WebRTC 投屏 */}
      <div className="dc-card-thumbnail" onClick={() => navigate(`/webrtc-screen-wall?ids=${instance.instanceId}`)}>
        {/* 选择框 */}
        <label className="dc-card-checkbox" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onToggle} />
        </label>
        {screenshotUrl && !imgError ? (
          <img src={screenshotUrl} alt="设备画面" onError={() => setImgError(true)} />
        ) : (
          <div className="dc-card-thumb-placeholder">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span>{instance.status === "running" ? "正在加载画面..." : "设备未运行"}</span>
          </div>
        )}
      </div>

      {/* 卡片主体 */}
      <div className="dc-card-body" onClick={onNavigate}>
        <div className="dc-card-header">
          <span className="dc-card-name" title={instance.instanceName}>
            {instance.instanceName || instance.instanceId}
          </span>
          <StatusPill status={instance.status} />
        </div>

        <div className="dc-card-meta">
          <div className="dc-card-row">
            <span className="dc-card-label">类型</span>
            <span>{instance.boardName || instance.boardType}</span>
          </div>
          <div className="dc-card-row">
            <span className="dc-card-label">IP</span>
            <span>{instance.ipAddress || "—"}</span>
          </div>
          {instance.osName && (
            <div className="dc-card-row">
              <span className="dc-card-label">系统</span>
              <span>{instance.osName}{instance.desktopEnv ? ` · ${instance.desktopEnv}` : ""}</span>
            </div>
          )}
          {(instance.memory || instance.diskSize) && (
            <div className="dc-card-row">
              {instance.memory && <><span className="dc-card-label">内存</span><span>{instance.memory}GB</span></>}
              {instance.memory && instance.diskSize && <span style={{ color: "var(--border)", margin: "0 4px" }}>|</span>}
              {instance.diskSize && <><span className="dc-card-label">磁盘</span><span>{instance.diskSize}GB</span></>}
            </div>
          )}
        </div>
      </div>

      {/* 卡片快捷操作 */}
      <div className="dc-card-actions">
        <button className="dc-action-btn" type="button" onClick={onTerminal} title="终端">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4l3 3-3 3M7 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span>终端</span>
        </button>
        <button className="dc-action-btn" type="button" onClick={onDesktop} title="远程桌面">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 13h4M7 10v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <span>桌面</span>
        </button>
        <button className="dc-action-btn" type="button" onClick={onFiles} title="文件管理">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4V3a1 1 0 011-1h3l1.5 1.5H11a1 1 0 011 1V11a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3"/></svg>
          <span>文件</span>
        </button>
        <button className={`dc-action-btn ${portMappingExpanded ? "dc-action-btn-active" : ""}`} type="button" onClick={onPortMapping} title="端口映射">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="7" r="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="10" cy="7" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M6 7h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <span>端口</span>
        </button>
        <button className="dc-action-btn" type="button" onClick={onNavigate} title="详情">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5 5h4M5 7h3M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          <span>详情</span>
        </button>
      </div>

      {/* 端口映射面板 */}
      {portMappingExpanded && (
        <PortMappingPanel instanceId={instance.instanceId} token={token} />
      )}
    </div>
  );
}

/* ───────── 端口映射面板组件 ───────── */

interface PortMappingPanelProps {
  instanceId: string;
  token?: string;
}

function PortMappingPanel({ instanceId, token }: PortMappingPanelProps) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newProtocol, setNewProtocol] = useState("TCP");
  const [newPort, setNewPort] = useState("");
  const [newRemark, setNewRemark] = useState("");
  const [notice, setNotice] = useState("");

  const overviewQuery = useQuery({
    queryKey: ["pm-overview", instanceId],
    queryFn: () => consoleApi.fetchPortMappingOverview(instanceId, token),
    enabled: !!instanceId && !!token,
  });

  const listQuery = useQuery({
    queryKey: ["pm-list", instanceId],
    queryFn: () => consoleApi.fetchPortMappings(instanceId, token),
    enabled: !!instanceId && !!token,
  });

  const rules = listQuery.data?.items ?? [];
  const natIp = overviewQuery.data?.natPublicIp ?? "";

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["pm-overview", instanceId] });
    queryClient.invalidateQueries({ queryKey: ["pm-list", instanceId] });
  };

  const createMut = useMutation({
    mutationFn: () => consoleApi.createPortMapping(instanceId, { protocol: newProtocol, privatePort: Number(newPort), remark: newRemark || undefined }, token),
    onSuccess: () => {
      setNewPort("");
      setNewRemark("");
      setCreating(false);
      setNotice("端口映射已创建");
      refresh();
      setTimeout(() => setNotice(""), 2000);
    },
    onError: (e) => {
      setNotice(e instanceof Error ? e.message : "创建失败");
      setTimeout(() => setNotice(""), 3000);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (mappingId: string) => consoleApi.deletePortMapping(instanceId, mappingId, token),
    onSuccess: () => {
      setNotice("已删除");
      refresh();
      setTimeout(() => setNotice(""), 2000);
    },
    onError: (e) => {
      setNotice(e instanceof Error ? e.message : "删除失败");
      setTimeout(() => setNotice(""), 3000);
    },
  });

  const portValid = Number(newPort) >= 1 && Number(newPort) <= 65535;

  return (
    <div className="dc-pm-panel" onClick={(e) => e.stopPropagation()}>
      {/* 概览 */}
      <div className="dc-pm-header">
        <div className="dc-pm-header-left">
          <span className="dc-pm-title">端口映射</span>
          {natIp && <span className="dc-pm-ip" title="NAT 公网 IP">{natIp}</span>}
        </div>
        <button className="dc-pm-add-btn" type="button" onClick={() => setCreating(!creating)}>+ 添加</button>
      </div>

      {notice && <div className="dc-pm-notice">{notice}</div>}

      {/* 创建表单 */}
      {creating && (
        <div className="dc-pm-create">
          <select value={newProtocol} onChange={(e) => setNewProtocol(e.target.value)}>
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
          </select>
          <input type="number" placeholder="内网端口" value={newPort} onChange={(e) => setNewPort(e.target.value)} min={1} max={65535} />
          <input type="text" placeholder="备注" value={newRemark} onChange={(e) => setNewRemark(e.target.value)} />
          <button className="dc-pm-submit" type="button" disabled={!portValid || createMut.isPending} onClick={() => createMut.mutate()}>
            {createMut.isPending ? "..." : "确定"}
          </button>
        </div>
      )}

      {/* 规则列表 */}
      {listQuery.isLoading ? (
        <div className="dc-pm-loading">加载中...</div>
      ) : rules.length === 0 ? (
        <div className="dc-pm-empty">暂无端口映射</div>
      ) : (
        <div className="dc-pm-rules">
          {rules.map((r) => (
            <div key={r.mappingId} className={`dc-pm-rule ${r.proxyStatus === "failed" ? "dc-pm-rule-failed" : ""}`}>
              <span className="dc-pm-proto">{r.protocol}</span>
              <span className="dc-pm-ports">{natIp ? `${natIp}:` : ""}{r.publicPort} → {r.privatePort}</span>
              {r.remark && <span className="dc-pm-remark">{r.remark}</span>}
              {r.proxyStatus === "failed" && <span className="dc-pm-fail" title={r.failReason}>⚠</span>}
              <button
                className="dc-pm-del"
                type="button"
                onClick={() => deleteMut.mutate(r.mappingId)}
                disabled={deleteMut.isPending}
                title="删除"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
