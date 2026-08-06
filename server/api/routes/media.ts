import { Hono } from "hono";
import { z } from "zod";
import {
  apiError,
  badRequest,
  rateLimit,
  requireAuth,
  type ApiEnv,
} from "../context";
import {
  createImageUpload,
  createVideoUpload,
  getVideo,
  MediaError,
  verifyStreamWebhook,
  videoThumbnailUrl,
} from "../../services/media";
import { markVideoFailed, publishVideoPost } from "../../services/posts";

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

const videoRequestSchema = z.object({
  maxDurationSeconds: z.number().int().min(1).max(1800).default(600),
});

media.post("/uploads/videos", requireAuth, async (c) => {
  await rateLimit(c, "upload-video", { max: 10, windowSeconds: 3600 });

  const body = await c.req.json().catch(() => ({}));
  const parsed = videoRequestSchema.safeParse(body);
  if (!parsed.success) throw badRequest("Invalid upload request.");

  try {
    const ticket = await createVideoUpload(
      c.env,
      { userId: c.get("user")!.id, postId: "pending" },
      parsed.data.maxDurationSeconds,
    );
    return c.json(ticket);
  } catch (error) {
    if (error instanceof MediaError) {
      throw apiError(
        502,
        "upload_unavailable",
        "Video uploads are unavailable right now. Try again shortly.",
      );
    }
    throw error;
  }
});

/**
 * Lets the composer poll while a video transcodes, so the UI can say "still
 * processing" instead of appearing to hang.
 */
media.get("/uploads/videos/:uid", requireAuth, async (c) => {
  try {
    const video = await getVideo(c.env, c.req.param("uid"));
    return c.json({
      ready: video.readyToStream,
      state: video.status?.state ?? "unknown",
      durationSeconds: video.duration,
      thumbnailUrl: video.thumbnail,
    });
  } catch {
    throw apiError(404, "not_found", "No such upload.");
  }
});

/* -------------------------------------------------------------------------- */
/* Stream webhook                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Stream calls this when a video finishes transcoding (or fails). It is the
 * only thing that moves a video post from `processing` to `published`.
 *
 * Always answer 200 once the signature checks out. A non-2xx makes Stream retry,
 * and a retry storm over a bug in our own handler is worse than a lost event —
 * the composer's poll and the scheduled sweep both catch stragglers.
 */
media.post("/webhooks/stream", async (c) => {
  const secret = c.env.CF_STREAM_WEBHOOK_SECRET;
  const raw = await c.req.text();

  if (!secret) {
    // Refuse rather than trust an unsigned callback that can publish content.
    throw apiError(503, "not_configured", "Webhook secret is not configured.");
  }

  const valid = await verifyStreamWebhook(
    secret,
    c.req.header("Webhook-Signature") ?? null,
    raw,
  );
  if (!valid) throw apiError(401, "bad_signature", "Invalid signature.");

  let payload: {
    uid?: string;
    readyToStream?: boolean;
    status?: { state?: string };
    duration?: number;
    input?: { width?: number; height?: number };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ ok: true });
  }

  const uid = payload.uid;
  if (!uid) return c.json({ ok: true });

  const db = c.get("db");
  const state = payload.status?.state;

  try {
    if (payload.readyToStream || state === "ready") {
      await publishVideoPost(db, uid, {
        durationSeconds: payload.duration,
        thumbnailUrl: videoThumbnailUrl(c.env, uid) ?? undefined,
        width: payload.input?.width,
        height: payload.input?.height,
      });
    } else if (state === "error") {
      await markVideoFailed(db, uid);
    }
  } catch (error) {
    console.error("stream webhook handling failed", { uid, error });
  }

  return c.json({ ok: true });
});
