import { useQuery } from "@tanstack/react-query";

export interface AuthUser {
  id:              string;
  email?:          string;
  firstName?:      string;
  lastName?:       string;
  profileImageUrl?: string;
  isAdmin?:        boolean;
  role?:           string;
}

async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return res.json() as Promise<AuthUser>;
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn:  fetchMe,
    retry:    false,
    staleTime: 5 * 60_000,
  });

  return {
    user:            user ?? null,
    isLoading,
    isAuthenticated: !!user,
    displayName:     user
      ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "User"
      : null,
    login:  () => { window.location.href = "/api/login"; },
    logout: () => { window.location.href = "/api/logout"; },
  };
}
