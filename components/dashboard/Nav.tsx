"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createBrowser } from "@/lib/supabase/browser";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || (href === "/dashboard" && path.startsWith("/projects"));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx("rounded-lg px-3 py-2 text-sm transition", active ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text")}
    >
      {children}
    </Link>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-2 hover:text-text"
      onClick={async () => { await createBrowser().auth.signOut(); router.replace("/login"); router.refresh(); }}
    >
      Sign out
    </button>
  );
}
