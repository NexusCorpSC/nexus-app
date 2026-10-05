import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslations } from "use-intl";
import { useAuth } from "@/auth/auth-context";
import { LoadingState } from "@/components/ui";

/** Gates the routes backed by authenticated Nexus Tools endpoints. */
export default function RequireAuth() {
  const t = useTranslations("Layout");
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingState label={t("checkingSession")} />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
