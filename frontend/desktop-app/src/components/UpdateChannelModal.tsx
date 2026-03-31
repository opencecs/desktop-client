import { useState } from "react";
import { getUpdateEndpoint, setUpdateEndpoint, getDefaultEndpoint } from "@/lib/updater";

interface UpdateChannelModalProps {
  onClose: () => void;
}

export function UpdateChannelModal({ onClose }: UpdateChannelModalProps) {
  const [endpoint, setEndpointValue] = useState(getUpdateEndpoint);

  const onSave = () => {
    setUpdateEndpoint(endpoint);
    onClose();
  };

  const onReset = () => {
    setEndpointValue(getDefaultEndpoint());
  };

  return (
    <div className="edit-profile-overlay" onClick={onClose}>
      <div className="edit-profile-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="edit-profile-header">
          <h2>更新渠道设置</h2>
          <button className="icon-button" type="button" onClick={onClose} title="关闭">✕</button>
        </div>
        <div style={{ marginBottom: "var(--space-4)" }}>
          <label className="edit-profile-label">更新服务器地址</label>
          <input
            className="edit-profile-input"
            type="url"
            value={endpoint}
            onChange={(e) => setEndpointValue(e.target.value)}
            placeholder="http://your-server.com/latest.json"
            spellCheck={false}
          />
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
            设置自定义更新源地址（需返回 Tauri 更新清单 JSON）。点击「恢复默认」使用本地开发服务器。
          </p>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)" }}>
          <button className="ghost-button" type="button" onClick={onReset}>恢复默认</button>
          <button className="primary-button" type="button" onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
