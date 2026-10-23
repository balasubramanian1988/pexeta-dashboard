// Text wordmark (no image dependency). Swap for /public/pexeta-logo.png if preferred.
export default function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`font-heading text-xl font-extrabold tracking-tight ${dark ? "text-navy" : "text-white"}`}>
      pexeta<span className="text-amber">.</span>
    </span>
  );
}
