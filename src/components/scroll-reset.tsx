"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Starts each routed page at its default, top-of-page position. */
export default function ScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
