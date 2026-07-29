import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "@/components/layout/app-layout";
import RequireAuth from "@/components/layout/require-auth";
import BlueprintsPage from "@/pages/blueprints-page";
import BlueprintDetailPage from "@/pages/blueprint-detail-page";
import FactionsPage from "@/pages/factions-page";
import MissionsPage from "@/pages/missions-page";
import MissionDetailPage from "@/pages/mission-detail-page";
import ReputationsPage from "@/pages/reputations-page";
import InventoryPage from "@/pages/inventory-page";
import OrgsPage from "@/pages/orgs-page";
import OrgInventoryPage from "@/pages/org-inventory-page";
import SettingsPage from "@/pages/settings-page";
import LoginPage from "@/pages/login-page";
import OverlayPage from "@/pages/overlay-page";
import CapturePage from "@/pages/capture-page";
import NotesPage from "@/pages/notes-page";
import NotesOverlayPage from "@/pages/notes-overlay-page";
import NotificationsOverlayPage from "@/pages/notifications-overlay-page";

export default function App() {
  return (
    <Routes>
      {/* Standalone windows: frameless and transparent, so they sit outside
          the chrome that AppLayout provides. */}
      <Route path="overlay" element={<OverlayPage />} />
      <Route path="capture" element={<CapturePage />} />
      <Route path="notes-overlay" element={<NotesOverlayPage />} />
      <Route path="notifications" element={<NotificationsOverlayPage />} />

      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/blueprints" replace />} />

        <Route path="blueprints" element={<BlueprintsPage />} />
        <Route path="blueprints/:slug" element={<BlueprintDetailPage />} />

        <Route path="missions" element={<MissionsPage />} />
        <Route path="missions/:missionId" element={<MissionDetailPage />} />

        {/* With an id when the search palette points at one faction. */}
        <Route path="factions" element={<FactionsPage />} />
        <Route path="factions/:factionId" element={<FactionsPage />} />

        <Route path="orgs" element={<OrgsPage />} />
        <Route path="notes" element={<NotesPage />} />

        <Route element={<RequireAuth />}>
          <Route path="reputations" element={<ReputationsPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="orgs/:orgId/inventory" element={<OrgInventoryPage />} />
        </Route>

        <Route path="settings" element={<SettingsPage />} />
        <Route path="login" element={<LoginPage />} />

        <Route path="*" element={<Navigate to="/blueprints" replace />} />
      </Route>
    </Routes>
  );
}
