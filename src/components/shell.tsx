"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Aperture, ArrowUpRight, FlaskConical } from "lucide-react";
import { useData } from "./api";
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: status } = useData<{ provider: string; configured: boolean }>(
    "status",
  );
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <Aperture size={27} strokeWidth={1.4} />
          <span>
            MAIN CHARACTER<span className="brand-lab">LAB</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          {[
            ["/", "Studio"],
            ["/identities", "Identities"],
            ["/history", "Archive"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? "active" : ""}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="local-badge">
          <span className="status-dot" /> Local workspace
        </div>
      </header>
      {status?.provider === "mock" && (
        <div className="notice">
          <FlaskConical size={16} /> Offline test mode. Training and images are
          fixtures; no external charges.
        </div>
      )}
      {status && !status.configured && (
        <div className="notice warning">
          Add <code>FAL_KEY</code> to <code>.env.local</code> and restart to
          train or generate. Your local library is available.
        </div>
      )}
      <main>{children}</main>
      <footer>
        <span>YOUR IDENTITY. A DIFFERENT FRAME.</span>
        <span>
          Stored locally <span className="muted">/</span> AI processing on fal{" "}
          <ArrowUpRight size={12} />
        </span>
      </footer>
    </>
  );
}
