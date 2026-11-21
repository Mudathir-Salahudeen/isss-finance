"use client";
import { useState } from "react";

export function ClassArmSelect({ classes, arms, defaultClassId, defaultArmId, required = true, prefix = "" }: {
  classes: { id: number; name: string }[]; arms: { id: number; classId: number; name: string }[]; defaultClassId?: number | null; defaultArmId?: number | null; required?: boolean; prefix?: string;
}) {
  const [cid, setCid] = useState<number | "">(defaultClassId ?? "");
  const opts = arms.filter((a) => a.classId === cid);
  return (
    <>
      <div>
        <label htmlFor={`${prefix}classId`} className="mb-1 block">Class{required && <span className="text-rose-600"> *</span>}</label>
        <select id={`${prefix}classId`} name="classId" required={required} value={cid} onChange={(e) => setCid(Number(e.target.value) || "")}>
          <option value="">Choose class…</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}armId`} className="mb-1 block">Arm</label>
        <select id={`${prefix}armId`} name="armId" defaultValue={defaultArmId ?? ""} key={String(cid)} required={opts.length > 0}>
          {opts.length ? <option value="">Choose arm…</option> : <option value="">(no arms)</option>}
          {opts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
    </>
  );
}
