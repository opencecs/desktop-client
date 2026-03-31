import React, { useState } from "react";

/**
 * 提示组件 Props
 * @property type - 提示类型：info / success / warning / error
 * @property message - 提示文案
 * @property dismissible - 是否可关闭
 * @property onDismiss - 关闭时的回调
 */
export interface AlertProps {
  type: "info" | "success" | "warning" | "error";
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}

/**
 * 高质感消息提示条组件
 * 适配项目 .inline-alert 样式体系
 */
export const Alert: React.FC<AlertProps> = ({
  type,
  message,
  dismissible = false,
  onDismiss,
  className = "",
}) => {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  /** 类型映射到 CSS 变体 */
  const toneClass = {
    info: "",
    success: "success",
    warning: "",
    error: "error",
  }[type];

  const handleDismiss = () => {
    console.log(`[Alert] 关闭: type=${type}`);
    setVisible(false);
    onDismiss?.();
  };

  return (
    <div className={`inline-alert ${toneClass} ${className}`.trim()} role="alert">
      <span>{message}</span>
      {dismissible && (
        <button className="alert-dismiss" type="button" onClick={handleDismiss} aria-label="关闭提示">
          ✕
        </button>
      )}
    </div>
  );
};
