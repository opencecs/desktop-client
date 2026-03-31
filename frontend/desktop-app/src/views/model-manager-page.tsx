/**
 * RK1828 NPU 模型管理页面
 * 支持模型文件上传、部署到 NPU 设备
 * 支持的模型格式：.rknn, .onnx, .tflite
 *
 * 工作流程：
 * 1. 识别 NPU 设备（board_type 包含 "rk1828" 或 "rk3588_rk1828"）
 * 2. 选择模型文件上传到设备 SharedStorage
 * 3. 通过 SSH 执行部署脚本将模型加载到 NPU
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { StatusPill } from "@/components/StatusPill";
import type { InstanceSummary } from "@/types";

/** 支持的模型文件扩展名 */
const MODEL_EXTENSIONS = [".rknn", ".onnx", ".tflite"];

/** 模型部署目标路径（设备端） */
const MODEL_DEPLOY_PATH = "/models";

/** 模型部署状态 */
type DeployStatus = "idle" | "uploading" | "deploying" | "success" | "error";

/** 单台设备的部署状态 */
interface DeviceDeployState {
  instanceId: string;
  instanceName: string;
  status: DeployStatus;
  progress: string;
  error?: string;
}

/**
 * 判断实例是否为 RK1828 NPU 设备
 */
function isNpuDevice(inst: InstanceSummary): boolean {
  const bt = (inst.boardType ?? "").toLowerCase();
  return bt === "rk3588_rk1828" || bt.includes("rk1828") || bt.includes("1828") || bt.includes("npu");
}

/**
 * 判断文件是否为支持的模型格式
 */
function isModelFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return MODEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * 获取模型格式描述
 */
function getModelFormatLabel(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".rknn")) return "RKNN (RK1828 原生)";
  if (lower.endsWith(".onnx")) return "ONNX (通用格式)";
  if (lower.endsWith(".tflite")) return "TFLite (轻量级)";
  return "未知格式";
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * RK1828 NPU 模型管理页面
 */
export function ModelManagerPage() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.session?.accessToken);

  // 获取所有实例
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => consoleApi.fetchDashboard(token),
    staleTime: 15_000,
  });

  // 筛选出 NPU 设备
  const npuDevices = useMemo(() => {
    const items = data?.items ?? [];
    const devices = items.filter(isNpuDevice);
    console.log("[ModelManager] NPU 设备筛选:", { total: items.length, npu: devices.length });
    return devices;
  }, [data]);

  // 非 NPU 设备（用于展示）
  const otherDevices = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((i) => !isNpuDevice(i));
  }, [data]);

  // 选中的目标设备
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 选择的模型文件
  const [modelFile, setModelFile] = useState<File | null>(null);

  // 部署状态
  const [deployStates, setDeployStates] = useState<DeviceDeployState[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<string>("");

  /** 选择模型文件 */
  const handleSelectModel = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = MODEL_EXTENSIONS.join(",");

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      if (!isModelFile(file.name)) {
        setDeployResult(`不支持的文件格式。支持的格式：${MODEL_EXTENSIONS.join(", ")}`);
        return;
      }

      console.log("[ModelManager] 选择模型文件:", { name: file.name, size: file.size });
      setModelFile(file);
      setDeployResult("");
    };

    input.click();
  }, []);

  /** 切换设备选中 */
  const toggleDevice = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** 全选 NPU 设备 */
  const selectAllNpu = useCallback(() => {
    if (selectedIds.size === npuDevices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(npuDevices.map((d) => d.instanceId)));
    }
  }, [npuDevices, selectedIds.size]);

  /**
   * 执行模型部署：
   * 1. 上传模型到设备 SharedStorage
   * 2. （预留）通过 SSH 执行部署脚本
   */
  const handleDeploy = useCallback(async () => {
    if (!modelFile || selectedIds.size === 0) return;

    const ids = Array.from(selectedIds);
    console.log("[ModelManager] 开始模型部署:", {
      model: modelFile.name,
      deviceCount: ids.length,
    });

    setIsDeploying(true);
    setDeployResult("");

    // 初始化部署状态
    const states: DeviceDeployState[] = ids.map((id) => ({
      instanceId: id,
      instanceName: npuDevices.find((d) => d.instanceId === id)?.instanceName ?? id,
      status: "idle",
      progress: "等待中",
    }));
    setDeployStates([...states]);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ids.length; i++) {
      const instanceId = ids[i];
      const state = states[i];

      // 步骤 1：上传模型到 SharedStorage
      state.status = "uploading";
      state.progress = "正在上传模型文件...";
      setDeployStates([...states]);

      try {
        const uploadKey = `${MODEL_DEPLOY_PATH}/${modelFile.name}`;
        console.log(`[ModelManager] 上传模型: ${modelFile.name} → ${instanceId}:${uploadKey}`);
        await consoleApi.uploadStorageFile(instanceId, uploadKey, modelFile, token);

        // 步骤 2：标记部署成功（SSH 部署脚本预留）
        state.status = "success";
        state.progress = "模型已上传到设备存储";
        successCount++;
        console.log(`[ModelManager] 模型上传成功: ${instanceId}`);
      } catch (err) {
        state.status = "error";
        state.progress = "上传失败";
        state.error = err instanceof Error ? err.message : "未知错误";
        failCount++;
        console.error(`[ModelManager] 模型部署失败: ${instanceId}`, err);
      }

      setDeployStates([...states]);
    }

    const resultMsg = `模型部署完成：成功 ${successCount} 台，失败 ${failCount} 台`;
    console.log("[ModelManager]", resultMsg);
    setDeployResult(resultMsg);
    setIsDeploying(false);

    // 刷新设备列表
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [modelFile, selectedIds, npuDevices, token, queryClient]);

  // 加载中
  if (isLoading) {
    return <div className="page-loading"><LoadingSpinner label="加载设备列表..." /></div>;
  }

  // 错误
  if (error) {
    return <div className="page-error"><Alert type="error" message={error instanceof Error ? error.message : "加载失败"} /></div>;
  }

  return (
    <div className="model-manager-page">
      {/* 页面标题 */}
      <div className="mm-header">
        <div className="mm-header-info">
          <h2>NPU 模型管理</h2>
          <span className="mm-header-subtitle">
            RK1828 NPU 设备模型部署 — 支持 .rknn / .onnx / .tflite 格式
          </span>
        </div>
      </div>

      {/* 模型选择区 */}
      <div className="mm-model-section">
        <div className="mm-model-card">
          <div className="mm-model-icon">🧠</div>
          <div className="mm-model-info">
            {modelFile ? (
              <>
                <span className="mm-model-name">{modelFile.name}</span>
                <span className="mm-model-meta">
                  {formatSize(modelFile.size)} · {getModelFormatLabel(modelFile.name)}
                </span>
              </>
            ) : (
              <span className="mm-model-placeholder">未选择模型文件</span>
            )}
          </div>
          <Button variant="primary" onClick={handleSelectModel}>
            {modelFile ? "更换模型" : "选择模型文件"}
          </Button>
        </div>
      </div>

      {/* 提示消息 */}
      {deployResult && (
        <Alert
          type={deployResult.includes("失败 0") ? "success" : deployResult.includes("失败") ? "error" : "info"}
          message={deployResult}
          dismissible
          onDismiss={() => setDeployResult("")}
        />
      )}

      {/* NPU 设备列表 */}
      <div className="mm-devices-section">
        <div className="mm-devices-header">
          <h3>NPU 设备 ({npuDevices.length})</h3>
          <div className="mm-devices-actions">
            <label className="dc-select-all">
              <input
                type="checkbox"
                checked={npuDevices.length > 0 && selectedIds.size === npuDevices.length}
                onChange={selectAllNpu}
              />
              <span>全选 ({selectedIds.size}/{npuDevices.length})</span>
            </label>
            <Button
              variant="primary"
              onClick={handleDeploy}
              disabled={!modelFile || selectedIds.size === 0 || isDeploying}
              loading={isDeploying}
            >
              部署模型到选中设备
            </Button>
          </div>
        </div>

        {npuDevices.length === 0 ? (
          <div className="mm-empty">
            <p>未发现 RK1828 NPU 设备</p>
            <p className="mm-hint">系统会自动识别 board_type 为 "rk3588_rk1828" 的设备</p>
            {otherDevices.length > 0 && (
              <p className="mm-hint">当前有 {otherDevices.length} 台非 NPU 设备</p>
            )}
          </div>
        ) : (
          <div className="mm-device-grid">
            {npuDevices.map((inst) => {
              const deployState = deployStates.find((s) => s.instanceId === inst.instanceId);
              return (
                <div
                  key={inst.instanceId}
                  className={`mm-device-card ${selectedIds.has(inst.instanceId) ? "mm-device-selected" : ""}`}
                >
                  <label className="mm-device-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(inst.instanceId)}
                      onChange={() => toggleDevice(inst.instanceId)}
                    />
                  </label>
                  <div className="mm-device-body">
                    <div className="mm-device-name">
                      {inst.instanceName || inst.instanceId}
                      <StatusPill status={inst.status} />
                    </div>
                    <div className="mm-device-meta">
                      <span>🔧 {inst.boardType}</span>
                      <span>🌐 {inst.ipAddress || "—"}</span>
                      {inst.memory && <span>💾 {inst.memory}GB</span>}
                    </div>
                    {/* 部署进度 */}
                    {deployState && (
                      <div className={`mm-deploy-status mm-deploy-${deployState.status}`}>
                        <span className="mm-deploy-label">
                          {deployState.status === "uploading" ? "📤" :
                           deployState.status === "deploying" ? "⚙️" :
                           deployState.status === "success" ? "✅" :
                           deployState.status === "error" ? "❌" : "⏳"}
                          {deployState.progress}
                        </span>
                        {deployState.error && (
                          <span className="mm-deploy-error">{deployState.error}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
