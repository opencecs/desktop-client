import React, { InputHTMLAttributes } from "react";

/**
 * 输入框组件 Props
 * @property label - 标签文案
 * @property error - 错误提示信息（可选）
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

/**
 * 高质感文本输入组件
 * 复用项目的 .login-form 样式体系，支持错误态高亮
 */
export const Input: React.FC<InputProps> = ({
  label,
  id,
  type = "text",
  error,
  className = "",
  onChange,
  ...rest
}) => {
  const inputId = id || `input-${label.replace(/\s+/g, "-").toLowerCase()}`;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.debug(`[Input] 值变更: field=${inputId}`);
    onChange?.(e);
  };

  return (
    <label className="form-field" htmlFor={inputId}>
      <span className="form-label">{label}</span>
      <input
        id={inputId}
        type={type}
        className={`form-input${error ? " has-error" : ""} ${className}`.trim()}
        onChange={handleChange}
        {...rest}
      />
      {error && <span className="form-error">{error}</span>}
    </label>
  );
};
