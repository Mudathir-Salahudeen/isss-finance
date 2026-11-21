"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LineChart, Line } from "recharts";

const naira = (k: number) => `₦${(k / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const short = (k: number) => {
  const v = Math.abs(k / 100);
  const s = v >= 1e9 ? `${(v / 1e9).toFixed(1)}bn` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0);
  return `${k < 0 ? "-" : ""}₦${s}`;
};
const COLORS = ["#1f9d55", "#a7e3bf", "#0d4a28", "#f59e0b", "#64748b", "#0891b2"];

export function TrendChart({ data, series, height = 240 }: { data: Record<string, unknown>[]; series: { key: string; label: string }[]; height?: number }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <div style={{ height }} role="img" aria-label={`Chart of ${series.map((s) => s.label).join(", ")} by month`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={short} tick={{ fontSize: 11 }} width={64} />
          <Tooltip formatter={(v) => naira(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={[6, 6, 0, 0]} maxBarSize={28} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineTrend({ data, series, height = 220 }: { data: Record<string, unknown>[]; series: { key: string; label: string }[]; height?: number }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-500">No data.</p>;
  return (
    <div style={{ height }} role="img" aria-label="Trend chart">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={short} tick={{ fontSize: 11 }} width={64} />
          <Tooltip formatter={(v) => naira(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => <Line key={s.key} dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HBar({ data, height }: { data: { label: string; value: number }[]; height?: number }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <div style={{ height: height ?? Math.max(140, data.length * 30 + 30) }} role="img" aria-label="Bar chart">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
          <XAxis type="number" tickFormatter={short} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={130} />
          <Tooltip formatter={(v) => naira(Number(v))} />
          <Bar dataKey="value" name="Amount" fill="#1f9d55" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
