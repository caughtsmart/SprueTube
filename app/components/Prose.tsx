/** Shared wrapper for the written pages: about, rules, safety, privacy, terms. */
export function Prose({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl py-2">
      <h1 className="text-2xl font-bold">{title}</h1>
      {updated ? (
        <p className="st-text-muted mt-1 text-xs">Last updated {updated}</p>
      ) : null}

      <div
        className={[
          // st-prose switches the long-form pages to Literata.
          "st-prose mt-6 space-y-4 text-[0.9375rem]",
          "[&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold",
          "[&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold",
          "[&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
          "[&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5",
          "[&_a]:text-[var(--color-primer-500)] [&_a:hover]:underline",
          "[&_strong]:text-[var(--text-strong)]",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
