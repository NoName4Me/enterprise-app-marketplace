"use client";
import Image from "next/image";
import { useState } from "react";

export function AppIcon({ name, category, iconRef, large = false }: { name: string; category: string; iconRef: string | null; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className={`app-icon icon-${category}${large ? " large" : ""}`} aria-hidden="true">
    {name.replace(/^演示\s*·\s*/u, "").slice(0, 1)}{iconRef && !failed && <Image src={iconRef} alt="" width={large ? 76 : 46} height={large ? 76 : 46} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </div>;
}
