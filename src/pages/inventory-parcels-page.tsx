import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ParcelList } from "@/components/inventory/parcels";

/** The parcels sent and received, as on the site's `/inventory/parcels`. */
export default function InventoryParcelsPage() {
  return (
    <>
      <Link
        to="/inventory"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-nexus-muted hover:text-nexus-bright"
      >
        <ArrowLeft className="size-3.5" />
        Inventaire
      </Link>
      <PageHeader
        title="Colis"
        description="Vos colis envoyés et reçus des 30 derniers jours."
      />
      <ParcelList />
    </>
  );
}
