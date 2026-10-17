"use client";
import { useActionState } from "react";
import Link from "next/link";
import { enterDemoAction, loginAction, registerAction } from "@/app/actions";
import { Icon } from "@/components/icon";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [state, action, pending] = useActionState(mode === "login" ? loginAction : registerAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {mode === "register" && (
        <>
          <Field name="name" label="OPERATOR NAME" placeholder="Ada Lovelace" />
          <Field name="workspace" label="WORKSPACE" placeholder="Helix Labs" />
        </>
      )}
      <Field name="email" type="email" label="EMAIL" placeholder="operator@company.com" required />
      <Field name="password" type="password" label="PASSWORD" placeholder="••••••••" required minLength={8} />
      {state?.error && <p role="alert" className="border border-bad/40 bg-bad/10 px-3 py-2 font-mono text-xs text-bad">{state.error}</p>}
      <button disabled={pending} className="btn btn-primary h-11 w-full"><Icon name={mode === "login" ? "lock" : "user"} size={16} /><span className="min-w-0 whitespace-normal">{pending ? (mode === "login" ? "AUTHENTICATING…" : "PROVISIONING WORKSPACE…") : mode === "login" ? "Sign in" : "Create operator account"}</span></button>
      <button type="button" disabled title="Google OAuth requires GOOGLE_CLIENT_ID configuration" className="btn h-11 w-full">Continue with Google · soon</button>
      <button type="submit" formAction={enterDemoAction} formNoValidate className="btn h-11 w-full border-amber/60 text-amber"><Icon name="play" size={16} /><span className="min-w-0 whitespace-normal">Try Demo · no account needed</span></button>
      <p className="text-sm leading-relaxed text-mute">Demo runs use Mock Runtime and simulated tools. Real AI requires a separately configured provider. <Link href="/docs/status" className="text-fg underline underline-offset-4">Beta status &amp; limits</Link></p>
      <p className="text-center text-sm text-mute">
        {mode === "login" ? <>New operator? <Link className="text-fg underline underline-offset-4" href="/register">Create account</Link></> : <>Have an account? <Link className="text-fg underline underline-offset-4" href="/login">Sign in</Link></>}
      </p>
    </form>
  );
}

function Field({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="label inline-flex items-center gap-2"><Icon name={p.type === "email" ? "mail" : p.type === "password" ? "lock" : "user"} size={13} />{label}</span>
      <input {...p} className="input mt-1.5" />
    </label>
  );
}
