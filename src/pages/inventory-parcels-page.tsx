import { BackLink } from "@/components/layout/back-link";
import { PageHeader } from "@/components/ui";
import { ParcelList } from "@/components/inventory/parcels";

/** The parcels sent and received, as on the site's `/inventory/parcels`. */
export default function InventoryParcelsPage() {
  return (
    <>
      <BackLink to="/inventory">Retour à l'inventaire</BackLink>
      <PageHeader
        title="Colis"
        description="Vos colis envoyés et reçus des 30 derniers jours."
      />
      <ParcelList />
    </>
  );
}
