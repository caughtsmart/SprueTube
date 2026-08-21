/*
 * Bug reports and feature requests.
 *
 * Kept as well as emailed. A feature request is a backlog and a bug is worth
 * still having after the reply, so both land in the `feedback` table and the
 * shared inbox both — unlike the contact form, which only ever forwards. The
 * table is the durable copy; the email is the nudge that someone should look.
 */

import type { Db } from "../db/client";
import { newId } from "../db/id";
import { feedback } from "../db/schema";

export async function createFeedback(
  db: Db,
  input: {
    userId: string | null;
    kind: "bug" | "feature";
    title: string;
    body: string;
    pageUrl: string | null;
    contactEmail: string | null;
  },
): Promise<{ id: string }> {
  const id = newId("fb");
  await db.insert(feedback).values({
    id,
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    pageUrl: input.pageUrl,
    contactEmail: input.contactEmail,
  });
  return { id };
}
