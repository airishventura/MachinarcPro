"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ ms = 5000 }: { ms?: number }) {
  const r = useRouter();
  useEffect(() => { const t = setInterval(() => r.refresh(), ms); return () => clearInterval(t); }, [r, ms]);
  return null;
}

export function Clock() {
  const [t, setT] = useState("");
  useEffect(() => { const f = () => setT(new Date().toTimeString().slice(0, 8)); f(); const i = setInterval(f, 1000); return () => clearInterval(i); }, []);
  return <span className="font-mono tabular-nums">{t}</span>;
}

