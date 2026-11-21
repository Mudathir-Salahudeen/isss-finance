import { requirePage } from "@/server/session";
import { listExpenseCategories, listVendors } from "@/server/services/expenses";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client/forms";
import { expenseCategoryAction, vendorAction } from "../actions";

export default async function Cats() {
  await requirePage("expenses.manage_categories");
  const [cats, vendors] = await Promise.all([listExpenseCategories(), listVendors()]);
  return (
    <>
      <PageHeader title="Expense categories & vendors" back={{ href: "/expenses", label: "Expenses" }} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Categories">
          <ul className="mb-4 grid grid-cols-2 gap-1 text-sm">{cats.filter((c) => !c.parentId).map((c) => <li key={c.id}>{c.name}{cats.filter((s) => s.parentId === c.id).map((s) => <div key={s.id} className="pl-3 text-xs text-slate-500">— {s.name}</div>)}</li>)}</ul>
          <ActionForm action={expenseCategoryAction} resetOnSuccess className="grid grid-cols-2 gap-3">
            <div><label htmlFor="cn" className="mb-1 block">New category</label><input id="cn" name="name" required /></div>
            <div><label htmlFor="cp" className="mb-1 block">Parent (for subcategory)</label><select id="cp" name="parentId"><option value="">—</option>{cats.filter((c) => !c.parentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <Submit>Add category</Submit></ActionForm>
        </Card>
        <Card title="Vendors">
          <ul className="mb-4 divide-y divide-slate-100 text-sm">{vendors.map((v) => <li key={v.id} className="py-1.5">{v.name} <span className="text-xs text-slate-500">{v.contactPerson} {v.phone} {v.email}</span></li>)}</ul>
          <ActionForm action={vendorAction} resetOnSuccess className="grid grid-cols-2 gap-3">
            <div><label htmlFor="vn" className="mb-1 block">Vendor name</label><input id="vn" name="name" required /></div>
            <div><label htmlFor="vc" className="mb-1 block">Contact person</label><input id="vc" name="contactPerson" /></div>
            <div><label htmlFor="vp" className="mb-1 block">Phone</label><input id="vp" name="phone" /></div>
            <div><label htmlFor="ve" className="mb-1 block">Email</label><input id="ve" name="email" type="email" /></div>
            <Submit>Add vendor</Submit></ActionForm>
        </Card>
      </div>
    </>
  );
}
