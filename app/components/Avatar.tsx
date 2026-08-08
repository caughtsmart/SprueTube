import { avatarFallback } from "../lib/media";

export function Avatar({
  username,
  src,
  size = 40,
  className = "",
}: {
  username: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const { colour, initials } = avatarFallback(username || "st");

  if (src) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        decoding="async"
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-black/80 ${className}`}
      style={{
        width: size,
        height: size,
        background: colour,
        fontSize: Math.max(10, size * 0.36),
      }}
    >
      {initials}
    </span>
  );
}
