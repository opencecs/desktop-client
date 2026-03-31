import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * 全局错误边界组件
 * 在子组件树发生未捕获 JS 异常时，显示优雅降级 UI 而非白屏
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] 捕获未处理异常:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <div className="error-boundary-card">
            <h3>应用遇到了问题</h3>
            <p>{this.state.error?.message || "发生了未知错误，请刷新页面重试。"}</p>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                console.log("[ErrorBoundary] 用户点击重试，重置错误状态");
                this.setState({ hasError: false, error: undefined });
              }}
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
