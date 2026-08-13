import { useRoot } from "../root";
import { TECHNIQUE_LABELS, type Technique } from "../lib/taxonomy";

export type RecipeStepView = {
  id: string;
  position: number;
  technique: string;
  productName: string | null;
  brand: string | null;
  shopUrl: string | null;
  note: string | null;
};

/**
 * A recipe's steps, in order — the method plus the paints, each linked to the
 * shop where it resolved.
 *
 * The shop links carry `rel="sponsored noopener"`, the same as the "paints
 * used" strip on a post: this is the commercial layer, declared as such rather
 * than hidden. An unresolved paint is plain text — a recipe reads fine with no
 * links at all, which is what it does until the storefront is configured.
 */
export function RecipeView({ steps }: { steps: RecipeStepView[] }) {
  const { shopName } = useRoot().config;

  if (!steps.length) {
    return (
      <p className="st-text-muted text-sm">This recipe has no steps yet.</p>
    );
  }

  return (
    <ol className="space-y-2">
      {steps.map((step, index) => (
        <li key={step.id} className="st-card flex gap-3 p-3">
          <span
            aria-hidden
            className="st-text-muted mt-0.5 w-5 shrink-0 text-right text-sm tabular-nums"
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="st-chip shrink-0 text-xs">
                {TECHNIQUE_LABELS[step.technique as Technique] ?? step.technique}
              </span>
              {step.productName ? (
                step.shopUrl ? (
                  <a
                    href={step.shopUrl}
                    rel="sponsored noopener"
                    target="_blank"
                    className="st-link text-sm font-medium"
                    title={`Find ${step.productName} at ${shopName}`}
                  >
                    {step.brand ? `${step.brand} ` : ""}
                    {step.productName}
                    <span aria-hidden> ↗</span>
                  </a>
                ) : (
                  <span className="st-text-strong text-sm font-medium">
                    {step.brand ? `${step.brand} ` : ""}
                    {step.productName}
                  </span>
                )
              ) : null}
            </div>
            {step.note ? (
              <p className="st-text-muted mt-1 text-sm">{step.note}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
