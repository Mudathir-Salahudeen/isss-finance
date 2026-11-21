import { requirePage } from "@/server/session";
import { getStructure } from "@/server/services/academics";
import { listFeeCategories } from "@/server/services/fees";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm } from "@/components/client/forms";
import { FeeFields } from "@/components/FeeForm";
import { createFeeAction } from "../actions";

export default async function NewFee() {
  await requirePage("fees.manage");
  const st = await getStructure();
  return (
    <>
      <PageHeader title="New fee" back={{ href: "/fees", label: "Fees" }} />
      <Card><ActionForm action={createFeeAction}><FeeFields cats={(await listFeeCategories()).filter((c) => c.active && c.name !== "Opening Balance")} sessions={st.sessions} terms={st.terms} classes={st.classes.filter((c) => c.active)} /></ActionForm></Card>
    </>
  );
}
