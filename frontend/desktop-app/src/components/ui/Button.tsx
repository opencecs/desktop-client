import React from "react";

/**
 * 按钮变体类型
 * - primary: 渐变主色按钮，用于核心操作（如登录、提交）
 * - ghost: 透明边框按钮，用于辅助操作
 * - danger: 红色警告按钮，用于危险操作（如删除）
 * - icon: 小尺寸图标按钮
 */
type ButtonVariant = "primary" | "ghost" | "danger" | "icon";

/**
 * 按钮组件 Props
 * @property variant - 按钮外观变体，默认 "primary"
 * @property block - 是否撑满父容器宽度
 * @property loading - 是否处于加载中状态（禁用并显示动画）
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
  loading?: boolean;
}

/**
 * 高质感通用按钮组件
 * 使用项目 CSS 变量体系，支持多种视觉变体和加载态
 */
export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "primary",
  block = false,
  loading = false,
  className = "",
  disabled,
  onClick,
  ...rest
}) => {
  /** 根据 variant 映射到项目已有的 CSS 类名 */
  const variantClass = {
    primary: "primary-button",
    ghost: "ghost-button",
    danger: "primary-button danger-variant",
    icon: "icon-button",
  }[variant];

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (loading || disabled) return;
    console.log(`[Button] 点击: variant=${variant}`);
    onClick?.(e);
  };

  return (
    <button
      className={`${variantClass}${block ? " block-button" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      onClick={handleClick}
      {...rest}
    >
      {loading ? (
        <>
          <span className="btn-spinner" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
};
