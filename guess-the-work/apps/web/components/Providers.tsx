"use client";
import { MotionConfig } from "framer-motion";

/** Framer Motion follows prefers-reduced-motion everywhere. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
