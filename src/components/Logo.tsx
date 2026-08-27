import Image from "next/image";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/app-config";

export function Logo({ compact = false, href = "/" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className={`brand-logo${compact ? " brand-logo--compact" : ""}`} aria-label={`${PRODUCT_NAME} ana sayfa`}>
      <Image className="brand-image" src="/mrap-logo.png" width={512} height={512} sizes="48px" alt="" priority />
      {compact ? null : <span className="brand-word">{PRODUCT_NAME}</span>}
    </Link>
  );
}
