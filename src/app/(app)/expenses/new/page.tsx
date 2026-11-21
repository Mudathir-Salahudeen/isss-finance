import { requirePage } from "@/server/session";
import { listExpenseCategories, listVendors } from "@/server/services/expenses";
import { accessibleAccounts } from "@/server/services/accounts";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm } from "@/components/client/forms";
import { ExpenseFields } from "@/components/ExpenseForm";
import { createExpenseAction } from "../actions";
import { todayISO } from "@/lib/dates";

export default async function NewExpense() {
  const a = await requirePage("expenses.create");
  const [cats, vendors, accs] = await Promise.all([listExpenseCategories(), listVendors(), accessibleAccounts(a)]);
  return (<><PageHeader title="Record expense" back={{ href: "/expenses", label: "Expenses" }} subtitle={a.roleName === "Director" ? "Your entry is recorded as Director-entered and follows the school's approval policy." : "Submitted expenses go to the Director for approval."} />
    <Card><ActionForm action={createExpenseAction}><ExpenseFields cats={cats.filter((c) => c.active)} vendors={vendors.filter((v) => v.active)} accounts={accs} today={todayISO()} /></ActionForm></Card></>);
}
