import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

/**
 * 全局错误边界。
 *
 * 修复：原实现只依赖 getDerivedStateFromError，没有 componentDidCatch，
 * 因此错误堆栈与组件栈从未被记录，线上白屏时无法定位。
 * 现在会记录错误、附带一个可复制的错误编号，并通过全局监听兜住
 * ErrorBoundary 捕获不到的异步异常（Promise rejection / 事件回调抛错）。
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidMount() {
    window.addEventListener("unhandledrejection", this.handleRejection);
    window.addEventListener("error", this.handleGlobalError);
  }

  componentWillUnmount() {
    window.removeEventListener("unhandledrejection", this.handleRejection);
    window.removeEventListener("error", this.handleGlobalError);
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const errorId = `FE-${Date.now().toString(36).toUpperCase()}`;
    this.setState({ errorId });
    // 记录堆栈与组件栈，便于线上排查（接入 Sentry 等平台时替换此处）
    console.error(`[ErrorBoundary ${errorId}]`, error, info.componentStack);
  }

  private handleRejection = (event: PromiseRejectionEvent) => {
    console.error("[UnhandledRejection]", event.reason);
  };

  private handleGlobalError = (event: ErrorEvent) => {
    console.error("[GlobalError]", event.error ?? event.message);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg-layout">
          <div className="bg-bg-base rounded-lg border border-border p-8 max-w-md text-center">
            <h2 className="text-lg font-bold text-primary mb-3">页面出现异常</h2>
            <p className="text-sm text-text-secondary mb-2">
              {this.state.error?.message || "未知错误"}
            </p>
            {this.state.errorId && (
              <p className="text-xs text-text-secondary/60 mb-4">
                错误编号：{this.state.errorId}（反馈问题时请提供）
              </p>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null, errorId: null });
                window.location.reload();
              }}
              className="px-6 py-2 bg-primary text-white rounded-md text-sm"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
