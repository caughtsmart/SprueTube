/*
 * Who operates SprueTube, in one place.
 *
 * The privacy notice and the terms both have to name the operator, and UK law
 * requires the two to agree. Written out twice they drift — one gets updated
 * after an address change and the other quietly keeps the old one, which is
 * exactly the kind of inconsistency that undermines the document it appears in.
 *
 * Deliberately dependency-free, like taxonomy.ts, so it costs the client bundle
 * nothing to import.
 */

export type Operator = {
  /**
   * The registered company name for a limited company, or the name the business
   * trades under for a sole trader. Not the brand — "Loaded Dice Ltd", not
   * "Loaded Dice", if a limited company is what stands behind it.
   */
  legalName: string | null;
  /** Companies House number. Null for a sole trader, who does not have one. */
  companyNumber: string | null;
  /**
   * A real geographic address. For a company this is the registered office; for
   * a sole trader it is an address for service. A PO box is not enough for
   * either.
   */
  address: string | null;
  /**
   * Entry on the ICO's data protection register. Not legally required in the
   * notice, but publishing it is the norm and it is checkable, which is worth
   * more than a paragraph of assurance.
   */
  icoNumber: string | null;
};

export const OPERATOR: Operator = {
  legalName: null,
  companyNumber: null,
  // Taken from the Loaded Dice Shopify billing address. Confirm this is the
  // right address for service for SprueTube before publishing.
  address: "28 Holton Road, Barry, CF63 4HD, Wales",
  icoNumber: null,
};

/**
 * The date shown as "last updated" on both documents.
 *
 * Null until they are reviewed and published. A legal document carrying a date
 * from before anyone read it is worse than one carrying none.
 */
export const LEGAL_UPDATED: string | null = null;

/**
 * Whether the documents can stand on their own yet.
 *
 * The name is the load-bearing part: a privacy notice that does not say who the
 * controller is fails at the first thing it exists to do. While this is false
 * both pages show a warning at the top, which disappears on its own once the
 * details are filled in — so it cannot be left up by accident.
 */
export function operatorReady(): boolean {
  return Boolean(OPERATOR.legalName && OPERATOR.address);
}

/**
 * "Loaded Dice Ltd (company 12345678), 28 Holton Road, Barry, CF63 4HD, Wales"
 *
 * Falls back to a visible placeholder rather than an empty string, so an
 * unconfigured build reads as obviously unfinished instead of as a document
 * with a hole where the operator should be.
 */
export function operatorLine(): string {
  if (!OPERATOR.legalName) return "[OPERATOR NOT SET]";
  const company = OPERATOR.companyNumber
    ? `${OPERATOR.legalName} (company ${OPERATOR.companyNumber})`
    : OPERATOR.legalName;
  return OPERATOR.address ? `${company}, ${OPERATOR.address}` : company;
}
