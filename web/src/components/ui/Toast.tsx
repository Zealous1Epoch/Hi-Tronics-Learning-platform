import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 未包裹 Provider 时降级为静默，避免页面崩溃
    return { success: () => {}, error: () => {}, info: () => {} };
  }
  return ctx;
}

type Listener = (kind: ToastKind, message: string) => void;

const listeners = new Set<Listener>();
const queue: { kind: ToastKind; message: string }[] = [];

function emit(kind: ToastKind, message: string) {
  if (listeners.size === 0) {
    queue.push({ kind, message });
    return;
  }
  listeners.forEach((l) => l(kind, message));
}

/** 可在 React 组件之外调用（例如工具函数、批量替换 alert 的场景） */
export const notify = {
  success: (message: string) => emit("success", message),
  error: (message: string) => emit("error", message),
  info: (message: string) => emit("info", message),
};

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const COLORS: Record<ToastKind, string> = {
  success: "var(--color-success)",
  error: "var(--color-danger)",
  info: "var(--color-primary)",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
      timers.current[id] = setTimeout(() => remove(id), kind === "error" ? 4000 : 2600);
    },
    [remove]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      Object.values(map).forEach(clearTimeout);
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push]
  );

  // 订阅模块级 notify，并把 Provider 挂载前的调用补发出来
  useEffect(() => {
    listeners.add(push);
    while (queue.length) {
      const item = queue.shift();
      if (item) push(item.kind, item.message);
    }
    return () => {
      listeners.delete(push);
    };
  }, [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {items.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              className="k-card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 14px",
                minWidth: 220,
                maxWidth: 420,
                boxShadow: "0 2px 10px rgba(20,20,19,0.08)",
                pointerEvents: "auto",
              }}
            >
              <Icon size={15} style={{ color: COLORS[t.kind], flexShrink: 0 }} />
              <span style={{ fontSize: 13, flex: 1 }}>{t.message}</span>
              <button
                onClick={() => remove(t.id)}
                aria-label="关闭提示"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  display: "flex",
                  padding: 0,
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}