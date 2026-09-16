import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const fn = useContext(ConfirmContext);
  return (
    fn ??
    // 未包裹 Provider 时降级到原生 confirm，保证功能不中断
    ((options: ConfirmOptions) => Promise.resolve(window.confirm(options.title)))
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  // 保存 resolve 以便组件卸载时兜底
  const pending = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setState({ ...options, resolve });
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setState((prev) => {
      prev?.resolve(value);
      return null;
    });
    pending.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="k-overlay" onClick={() => close(false)}>
          <div className="k-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", gap: 12 }}>
              {state.danger && (
                <AlertTriangle
                  size={18}
                  style={{ color: "var(--color-danger)", flexShrink: 0, marginTop: 2 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3
                  className="k-title"
                  style={{ fontSize: 15, color: "var(--color-text-base)", margin: "0 0 6px" }}
                >
                  {state.title}
                </h3>
                {state.message && (
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--color-text-secondary)",
                      margin: 0,
                      lineHeight: 1.7,
                    }}
                  >
                    {state.message}
                  </p>
                )}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button className="k-btn k-btn-default" onClick={() => close(false)}>
                {state.cancelText ?? "取消"}
              </button>
              <button
                className={state.danger ? "k-btn k-btn-danger" : "k-btn k-btn-primary"}
                onClick={() => close(true)}
                autoFocus
              >
                {state.confirmText ?? "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}