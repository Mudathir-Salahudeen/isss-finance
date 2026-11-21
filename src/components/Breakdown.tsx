import { formatNaira, pct } from "@/lib/money";
import { Card, Bar } from "./ui";

export function Breakdown({ title, rows, prev, total, count }: { title: string; rows: { key: string; amount: number; count?: number; payments?: number }[]; prev?: { key: string; amount: number }[]; total?: number; count?: string }) {
  const t = total ?? rows.reduce((s, r) => s + r.amount, 0);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <Card title={title}>
      {!rows.length ? <p className="text-sm text-slate-500">No data for this period.</p> : (
        <table><tbody>{rows.map((r) => {
          const p = prev?.find((x) => x.key === r.key)?.amount;
          return (<tr key={r.key}><td className="td w-1/3">{r.key}</td><td className="td"><Bar value={r.amount} max={max} /></td><td className="td num font-medium">{formatNaira(r.amount)}</td>
            <td className="td num text-xs text-slate-500">{pct(r.amount, t)}</td>
            {count && <td className="td num text-xs text-slate-500">{r.count ?? r.payments} {count}</td>}
            {prev && <td className="td num text-xs">{p === undefined ? <span className="text-slate-400">new</span> : <span className={r.amount >= p ? "text-brand-700" : "text-rose-600"}>{r.amount >= p ? "▲" : "▼"} {formatNaira(Math.abs(r.amount - p))}</span>}</td>}</tr>);
        })}</tbody></table>
      )}
    </Card>
  );
}
