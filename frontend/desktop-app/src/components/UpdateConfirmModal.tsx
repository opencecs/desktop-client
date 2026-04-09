import type { VersionCheckResult } from "@/lib/updater";

interface UpdateConfirmModalProps {
  versionInfo: VersionCheckResult;
  installing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function formatFileSize(bytes?: number): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateConfirmModal({ versionInfo, installing, onConfirm, onClose }: UpdateConfirmModalProps) {
  const sizeText = formatFileSize(versionInfo.fileSize);
  return (
    <div className="edit-profile-overlay" onClick={installing ? undefined : onClose}>
      <div className="edit-profile-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="edit-profile-header">
          <h2>{installing ? "正在更新" : "发现新版本"}</h2>
          {!installing && (
            <button className="icon-button" type="button" onClick={onClose} title="关闭">✕</button>
          )}
        </div>

        {installing ? (
          <div style={{ textAlign: "center", padding: "var(--space-4) 0" }}>
            <div className="update-spinner" style={{ width: 32, height: 32, margin: "0 auto var(--space-4)", borderWidth: 3 }} />
            <p style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>
              正在下载并安装 {versionInfo.latestVersion}，安装完成后将自动重启...
            </p>
            <p style={{ color: "var(--text-3)", fontSize: "0.8rem", marginTop: "var(--space-2)" }}>
              请勿关闭应用
            </p>
          </div>
        ) : (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <div className="update-version-row">
              <span>当前版本</span>
              <strong>{versionInfo.currentVersion}</strong>
            </div>
            <div className="update-version-row">
              <span>最新版本</span>
              <strong style={{ color: "var(--accent-light)" }}>{versionInfo.latestVersion}</strong>
            </div>
            {sizeText && (
              <div className="update-version-row">
                <span>安装包大小</span>
                <strong>{sizeText}</strong>
              </div>
            )}
            {versionInfo.notes && (
              <div className="update-notes">
                <p style={{ fontSize: "0.82rem", color: "var(--text-2)", marginTop: "var(--space-3)" }}>
                  {versionInfo.notes}
                </p>
              </div>
            )}
          </div>
        )}

        {!installing && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)" }}>
            <button className="ghost-button" type="button" onClick={onClose}>稍后再说</button>
            <button className="primary-button" type="button" onClick={onConfirm}>
              立即更新
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
