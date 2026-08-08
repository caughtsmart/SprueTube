import { Hono } from "hono";
import { z } from "zod";
import {
  apiError,
  badRequest,
  rateLimit,
  requireAuth,
  type ApiEnv,
} from "../context";
import { createImageUpload, MediaError } from "../../services/media";

export const media = new Hono<ApiEnv>();

const imageRequestSchema = z.object({
  purpose: z.enum(["post", "avatar", "banner", "cover"]).default("post"),
  count: z.number().int().min(1).max(8).default(1),
});

/**
 * Mint direct-upload tickets. The file itself never touches this Worker — see
 * the note at the top of services/media.ts.
 */
media.post("/uploads/images", requireAuth, async (c) => {
  await rateLimit(c, "upload-image", { max: 80, windowSeconds: 600 });

  const body = await c.req.json().catch(() => ({}));
  const parsed = imageRequestSchema.safeParse(body);
  if (!parsed.success) throw badRequest("Invalid upload request.");

  try {
    const tickets = await Promise.all(
      Array.from({ length: parsed.data.count }, () =>
        createImageUpload(c.env, {
          userId: c.get("user")!.id,
          purpose: parsed.data.purpose,
        }),
      ),
    );
    return c.json({ tickets });
  } catch (error) {
    if (error instanceof MediaError) {
      throw apiError(
        502,
        "upload_unavailable",
        "Image uploads are unavailable right now. Try again shortly.",
      );
    }
    throw error;
  }
});
