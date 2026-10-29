import Image from "next/image";

interface BrandLockupProps {
  isDark: boolean;
  responsive?: boolean;
  className?: string;
}

export function BrandLockup({
  isDark,
  responsive = false,
  className = "",
}: BrandLockupProps) {
  const lockup = isDark ? "/brand/lockup-paper.svg" : "/brand/lockup-ink.svg";

  if (!responsive) {
    return (
      <Image
        className={`ledger-brand-lockup ${className}`.trim()}
        src={lockup}
        alt="DataDarshanam"
        width={180}
        height={46}
        unoptimized
      />
    );
  }

  return (
    <span className={`ledger-brand-responsive ${className}`.trim()}>
      <Image
        className="ledger-brand-lockup"
        src={lockup}
        alt=""
        width={180}
        height={46}
        unoptimized
      />
      <Image
        className="ledger-brand-mark"
        src="/brand/icon.svg"
        alt=""
        width={40}
        height={40}
        unoptimized
      />
    </span>
  );
}
