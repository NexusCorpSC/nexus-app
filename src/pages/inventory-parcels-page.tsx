import { useTranslations } from "use-intl";
import { BackLink } from "@/components/layout/back-link";
import { PageHeader } from "@/components/ui";
import { ParcelList } from "@/components/inventory/parcels";

/** The parcels sent and received, as on the site's `/inventory/parcels`. */
export default function InventoryParcelsPage() {
  const t = useTranslations("Parcels");
  return (
    <>
      <BackLink to="/inventory">{t("page.back")}</BackLink>
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <ParcelList />
    </>
  );
}
