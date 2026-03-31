import React from "react";

/**
 * 加载动画组件 Props
 * @property size - 尺寸：small(16px) / medium(24px) / large(40px)
 * @property label - 附带的加载文案（可选）
 */
export interface LoadingSpinnerProps {
  size?: "small" | "medium" | "large";
  label?: string;
  className?: string;
}

/**
 * 高质感旋转加载指示器
 * 使用 CSS 关键帧动画，适配项目暗色主题
 */
export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "medium",
  label,
  className = "",
}) => {
  /** 尺寸映射 */
  const dim = { small: 16, medium: 24, large: 40 }[size];

  return (
    <span className={`loading-spinner-wrap ${className}`.trim()}>
      <span
        className="loading-spinner"
        style={{ width: dim, height: dim }}
        role="status"
        aria-label="加载中"
      />
      {label && <span className="loading-spinner-label">{label}</span>}
    </span>
  );
};
