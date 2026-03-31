import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleApi } from "@/api/console";
import { describeApiError } from "@/api/client";
import { SectionCard } from "@/components/SectionCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { useAuthStore } from "@/stores/auth-store";
import type { StorageFileItem } from "@/types";

/** 格式化文件大小为可读字符串 */
function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
  return `${size} ${units[i]}`;
}

/** 根据文件名获取图标符号 */
function fileIcon(item: StorageFileItem): string {
  if (item.isDir) return "📁";
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return "🖼️";
  if (["mp4", "avi", "mkv", "mov", "wmv"].includes(ext)) return "🎬";
  if (["mp3", "wav", "flac", "aac", "ogg"].includes(ext)) return "🎵";
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) return "📦";
  if (["pdf"].includes(ext)) return "📄";
  if (["doc", "docx", "txt", "md"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["rknn", "onnx", "tflite", "pb"].includes(ext)) return "🧠";
  return "📄";
}

/**
 * 文件管理页面
 * 提供文件浏览、上传、下载、创建文件夹、删除等功能
 */
export function FileManagerPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当前目录路径（面包屑导航）
  const [currentPath, setCurrentPath] = useState("");
  // 新建文件夹对话框
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // 上传状态
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<StorageFileItem | null>(null);
  // 操作反馈
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 清除反馈信息
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);

  // 存储概览查询（instanceId 不存在时 enabled=false，不会发请求）
  const overviewQuery = useQuery({
    queryKey: ["storage", "overview", instanceId, session?.accessToken],
    queryFn: () => consoleApi.fetchStorageOverview(instanceId!, session?.accessToken),
    enabled: Boolean(session && instanceId),
  });

  // 文件列表查询
  const filesQuery = useQuery({
    queryKey: ["storage", "files", instanceId, currentPath, session?.accessToken],
    queryFn: () => consoleApi.fetchStorageFiles(instanceId!, currentPath || undefined, 1, 200, session?.accessToken),
    enabled: Boolean(session && instanceId),
  });

  /** 刷新文件列表 */
  const refreshFiles = useCallback(() => {
    console.log("[FileManager] 刷新文件列表", { instanceId, currentPath });
    queryClient.invalidateQueries({ queryKey: ["storage", "files", instanceId] });
    queryClient.invalidateQueries({ queryKey: ["storage", "overview", instanceId] });
  }, [queryClient, instanceId, currentPath]);

  /** 进入子目录 */
  const enterDirectory = useCallback((item: StorageFileItem) => {
    if (!item.isDir) return;
    console.log("[FileManager] 进入目录", { key: item.key });
    setCurrentPath(item.key);
  }, []);

  /** 面包屑导航 — 返回指定层级 */
  const navigateToPath = useCallback((path: string) => {
    console.log("[FileManager] 导航到路径", { path });
    setCurrentPath(path);
  }, []);

  // 没有选定实例时显示实例选择器
  if (!instanceId) {
    return <InstanceSelector navigate={navigate} token={session?.accessToken} />;
  }

  /** 构建面包屑项 */
  const breadcrumbs = (() => {
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs = [{ label: "根目录", path: "" }];
    let accumulated = "";
    for (const part of parts) {
      accumulated += part + "/";
      crumbs.push({ label: part, path: accumulated });
    }
    return crumbs;
  })();

  /** 创建文件夹 */
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const folderPath = currentPath + newFolderName.trim() + "/";
    console.log("[FileManager] 创建文件夹", { folderPath });
    try {
      await consoleApi.createStorageFolder(instanceId, { path: folderPath }, session?.accessToken);
      setFeedback({ type: "success", message: `文件夹 "${newFolderName}" 创建成功` });
      setNewFolderName("");
      setShowNewFolder(false);
      refreshFiles();
    } catch (err) {
      console.error("[FileManager] 创建文件夹失败", err);
      setFeedback({ type: "error", message: describeApiError(err) });
    }
  };

  /** 上传文件 */
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = currentPath + file.name;
      setUploadProgress(`正在上传 ${file.name} (${i + 1}/${files.length})`);
      console.log("[FileManager] 上传文件", { key, size: file.size, type: file.type });

      try {
        await consoleApi.uploadStorageFile(instanceId, key, file, session?.accessToken);
        successCount++;
      } catch (err) {
        console.error("[FileManager] 上传文件失败", { key, err });
        failCount++;
      }
    }

    setUploading(false);
    setUploadProgress("");
    // 重置 input 以允许重复上传同名文件
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (failCount === 0) {
      setFeedback({ type: "success", message: `${successCount} 个文件上传成功` });
    } else {
      setFeedback({ type: "error", message: `${successCount} 个成功，${failCount} 个失败` });
    }
    refreshFiles();
  };

  /** 下载文件 */
  const handleDownload = (item: StorageFileItem) => {
    if (item.isDir) return;
    console.log("[FileManager] 下载文件", { key: item.key });
    const url = consoleApi.getDownloadUrl(instanceId, item.key);
    // 通过隐藏 anchor 触发浏览器下载
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    // 添加认证 token 到 URL（下载代理已在后端处理认证）
    if (session?.accessToken) {
      const separator = url.includes("?") ? "&" : "?";
      a.href = `${url}${separator}token=${encodeURIComponent(session.accessToken)}`;
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /** 确认删除 */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    console.log("[FileManager] 删除文件/文件夹", { key: deleteTarget.key });
    try {
      await consoleApi.deleteStorageFile(instanceId, deleteTarget.key, session?.accessToken);
      setFeedback({ type: "success", message: `"${deleteTarget.name}" 已删除` });
      setDeleteTarget(null);
      refreshFiles();
    } catch (err) {
      console.error("[FileManager] 删除失败", err);
      setFeedback({ type: "error", message: describeApiError(err) });
    }
  };

  const overview = overviewQuery.data;
  const files = filesQuery.data?.items ?? [];
  const isLoading = filesQuery.isLoading;
  const isError = filesQuery.isError;

  return (
    <div className="page-container">
      <div className="fm-header-bar" style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
        <button className="ghost-button" onClick={() => navigate(-1)} style={{ padding: "6px 12px" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: "6px", verticalAlign: "-3px" }}><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          返回
        </button>
        <h2 style={{ margin: 0, fontSize: "1.2rem" }}>文件管理 - {instanceId}</h2>
      </div>

      {/* 操作反馈提示 */}
      {feedback && (
        <div className={`file-feedback file-feedback--${feedback.type}`}>
          {feedback.message}
        </div>
      )}

      {/* 存储概览 */}
      {overview && (
        <div className="file-overview">
          <div className="file-overview__item">
            <span className="file-overview__label">总容量</span>
            <span className="file-overview__value">{formatFileSize(overview.totalSize)}</span>
          </div>
          <div className="file-overview__item">
            <span className="file-overview__label">已使用</span>
            <span className="file-overview__value">{formatFileSize(overview.usedSize)}</span>
          </div>
          <div className="file-overview__item">
            <span className="file-overview__label">文件数</span>
            <span className="file-overview__value">{overview.fileCount}</span>
          </div>
          <div className="file-overview__item">
            <span className="file-overview__label">文件夹</span>
            <span className="file-overview__value">{overview.folderCount}</span>
          </div>
          {overview.totalSize > 0 && (
            <div className="file-overview__bar">
              <div
                className="file-overview__bar-fill"
                style={{ width: `${Math.min(100, (overview.usedSize / overview.totalSize) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* 工具栏 */}
      <div className="file-toolbar">
        {/* 面包屑导航 */}
        <div className="file-breadcrumbs">
          {breadcrumbs.map((crumb, idx) => (
            <span key={crumb.path}>
              {idx > 0 && <span className="file-breadcrumbs__sep">/</span>}
              {idx === breadcrumbs.length - 1 ? (
                <span className="file-breadcrumbs__current">{crumb.label}</span>
              ) : (
                <button
                  className="file-breadcrumbs__link"
                  onClick={() => navigateToPath(crumb.path)}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="file-toolbar__actions">
          <button className="btn btn--sm" onClick={refreshFiles} title="刷新">
            🔄 刷新
          </button>
          <button className="btn btn--sm" onClick={() => setShowNewFolder(true)} title="新建文件夹">
            📁 新建文件夹
          </button>
          <label className="btn btn--sm btn--primary file-upload-btn">
            📤 上传文件
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleUpload}
              style={{ display: "none" }}
            />
          </label>
        </div>
      </div>

      {/* 上传进度 */}
      {uploading && (
        <div className="file-upload-progress">
          <LoadingSpinner /> {uploadProgress}
        </div>
      )}

      {/* 新建文件夹对话框 */}
      {showNewFolder && (
        <div className="file-modal-overlay" onClick={() => setShowNewFolder(false)}>
          <div className="file-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="file-modal__title">新建文件夹</h3>
            <input
              className="file-modal__input"
              type="text"
              placeholder="文件夹名称"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              autoFocus
            />
            <div className="file-modal__actions">
              <button className="btn btn--sm" onClick={() => setShowNewFolder(false)}>取消</button>
              <button className="btn btn--sm btn--primary" onClick={handleCreateFolder}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      {deleteTarget && (
        <div className="file-modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="file-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="file-modal__title">确认删除</h3>
            <p className="file-modal__text">
              确定要删除 {deleteTarget.isDir ? "文件夹" : "文件"} "{deleteTarget.name}" 吗？此操作不可撤销。
            </p>
            <div className="file-modal__actions">
              <button className="btn btn--sm" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn btn--sm btn--danger" onClick={handleDelete}>删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 文件列表 */}
      <SectionCard title="文件列表">
        {isLoading ? (
          <LoadingSpinner />
        ) : isError ? (
          <EmptyState title="加载文件列表失败" description={describeApiError(filesQuery.error)} />
        ) : files.length === 0 ? (
          <EmptyState title="当前目录为空" description="" />
        ) : (
          <div className="file-list">
            <div className="file-list__header">
              <span className="file-list__col file-list__col--name">名称</span>
              <span className="file-list__col file-list__col--size">大小</span>
              <span className="file-list__col file-list__col--time">修改时间</span>
              <span className="file-list__col file-list__col--actions">操作</span>
            </div>
            {files.map((item) => (
              <div
                key={item.key}
                className={`file-list__row ${item.isDir ? "file-list__row--dir" : ""}`}
                onDoubleClick={() => item.isDir && enterDirectory(item)}
              >
                <span className="file-list__col file-list__col--name">
                  <span className="file-list__icon">{fileIcon(item)}</span>
                  {item.isDir ? (
                    <button
                      className="file-list__name-link"
                      onClick={() => enterDirectory(item)}
                    >
                      {item.name}
                    </button>
                  ) : (
                    <span className="file-list__name-text">{item.name}</span>
                  )}
                </span>
                <span className="file-list__col file-list__col--size">
                  {item.isDir ? "—" : formatFileSize(item.size)}
                </span>
                <span className="file-list__col file-list__col--time">
                  {item.lastModified || "—"}
                </span>
                <span className="file-list__col file-list__col--actions">
                  {!item.isDir && (
                    <button
                      className="btn btn--xs"
                      onClick={() => handleDownload(item)}
                      title="下载"
                    >
                      ⬇️
                    </button>
                  )}
                  <button
                    className="btn btn--xs btn--danger"
                    onClick={() => setDeleteTarget(item)}
                    title="删除"
                  >
                    🗑️
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ───────── 实例选择器（无 instanceId 时展示） ───────── */

function InstanceSelector({
  navigate,
  token,
}: {
  navigate: ReturnType<typeof useNavigate>;
  token?: string;
}) {
  const [search, setSearch] = useState("");

  const storageQuery = useQuery({
    queryKey: ["storage-instances", token],
    queryFn: () => consoleApi.fetchStorageInstances(token),
    enabled: Boolean(token),
  });

  const instances = storageQuery.data?.instances ?? [];
  const filtered = search.trim()
    ? instances.filter((inst) =>
        [inst.instanceId, inst.displayName]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : instances;

  return (
    <div className="page-container">
      <SectionCard title="文件管理 — 选择存储实例">
        <div className="fm-selector">
          <input
            className="fm-selector-search"
            type="text"
            placeholder="搜索存储实例名称或 ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {storageQuery.isLoading ? (
            <LoadingSpinner />
          ) : filtered.length === 0 ? (
            <EmptyState title="暂无可用存储实例" description="请先创建共享存储实例" />
          ) : (
            <div className="fm-selector-list">
              {filtered.map((inst) => (
                <button
                  key={inst.instanceId}
                  className="fm-selector-item"
                  onClick={() => navigate(`/files/${inst.instanceId}`)}
                >
                  <span className="fm-selector-icon">📁</span>
                  <span className="fm-selector-info">
                    <span className="fm-selector-name">{inst.displayName || inst.instanceId}</span>
                    <span className="fm-selector-meta">{inst.instanceId} · {inst.capacityGb} GB · {inst.usedPercent.toFixed(1)}% 已用</span>
                  </span>
                  <span className={`fm-selector-status fm-selector-status--${inst.accessMode}`}>{inst.accessMode}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
