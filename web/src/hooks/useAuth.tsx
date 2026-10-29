import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { UserInfo } from "../lib/api";
import { getMe } from "../lib/api";

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  setUser: (user: UserInfo | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  setUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("lp_token");
    if (token) {
      getMe()
        .then((u) => setUser(u))
        .catch(() => {
          // 仅清除本次校验用的那个旧 token；若存储里已经是别的新 token
          // （SSO 回调刚刚写入），绝不能动它，否则会清掉一次成功的登录。
          if (localStorage.getItem("lp_token") === token) {
            localStorage.removeItem("lp_token");
            localStorage.removeItem("lp_user");
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const logout = () => {
    localStorage.removeItem("lp_token");
    localStorage.removeItem("lp_user");
    setUser(null);
    window.location.href = `${import.meta.env.BASE_URL}login`;
  };

  return (
    <AuthContext.Provider value={{ user, loading, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}