import { useEffect } from "react";
import { Link, redirect } from "react-router";
import { and, desc, eq, isNull, notInArray, or } from "drizzle-orm";
import type { Route } from "./+types/notifications";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { getScope } from "../lib/data.server";
import { timeAgo } from "../lib/format";
import { imageSrc } from "../lib/media";
import { useRoot } from "../root";
import { notification, profile } from "../../server/db/schema";
import { blockedUserIds } from "../../server/services/moderation";

export function meta() {
  return [
    { title: "Notifications — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/notifications");

  // Same filter as GET /notifications: rows written before a block still name
  // and picture the person who was blocked. System messages have no actor and
  // must stay.
  const hidden = await blockedUserIds(scope.db, scope.viewer.userId);

  const rows = await scope.db
    .select({
      id: notification.id,
      type: notification.type,
      subjectType: notification.subjectType,
      subjectId: notification.subjectId,
      preview: notification.preview,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      actorUsername: profile.username,
      actorDisplayName: profile.displayName,
      actorAvatarImageId: profile.avatarImageId,
    })
    .from(notification)
    .leftJoin(profile, eq(profile.userId, notification.actorId))
    .where(
      and(
        eq(notification.userId, scope.viewer.userId),
        ...(hidden.length
          ? [
              or(
                isNull(notification.actorId),
                notInArray(notification.actorId, hidden),
              )!,
            ]
          : []),
      ),
    )
    .orderBy(desc(notification.createdAt))
    .limit(100);

  return { notifications: rows };
}

const VERB: Record<string, string> = {
  like: "liked your post",
  comment: "commented on your post",
  reply: "replied to you",
  follow: "started following you",
  mention: "mentioned you",
  message: "sent you a message",
  listing_reply: "replied about your listing",
  system: "",
};

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { config } = useRoot();

  // Mark everything read on arrival. Doing it here rather than in the loader
  // keeps the loader idempotent, so a prefetch or a revalidation cannot clear
  // the badge before the person has actually looked at the list.
  useEffect(() => {
    if (loaderData.notifications.some((item) => !item.readAt)) {
      void api.post("/notifications/read").catch(() => undefined);
    }
  }, [loaderData.notifications]);

  if (!loaderData.notifications.length) {
    return (
      <div className="st-card mx-auto max-w-2xl p-10 text-center">
        <div aria-hidden className="st-hazard mx-auto h-2.5 w-32 rounded-sm" />
        <h1 className="mt-4 text-lg font-semibold">Nothing yet</h1>
        <p className="st-text-muted mt-2 text-sm">
          Likes, comments and new followers land here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Notifications</h1>

      <ul className="flex flex-col gap-2">
        {loaderData.notifications.map((item) => {
          /*
           * A message notification carries the conversation id, not a message
           * id — one message is not a thing you can navigate to, and landing
           * someone in the middle of a thread is worse than landing them at the
           * top of it.
           */
          const href =
            item.type === "follow"
              ? `/@${item.actorUsername ?? ""}`
              : item.subjectType === "message" && item.subjectId
                ? `/messages/${item.subjectId}`
                : item.subjectType === "post" && item.subjectId
                  ? `/posts/${item.subjectId}`
                  : "/";

          return (
            <li
              key={item.id}
              className={`st-card p-3 ${
                item.readAt ? "" : "border-l-2 border-l-[var(--color-primer-500)]"
              }`}
            >
              <Link to={href} className="flex items-start gap-3">
                {item.actorUsername ? (
                  <Avatar
                    username={item.actorUsername}
                    src={imageSrc(config, item.actorAvatarImageId, "avatar")}
                    size={36}
                  />
                ) : (
                  <span className="text-2xl">🛡</span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {item.actorDisplayName ? (
                      <span className="st-text-strong font-semibold">
                        {item.actorDisplayName}
                      </span>
                    ) : (
                      <span className="st-text-strong font-semibold">
                        SprueTube
                      </span>
                    )}{" "}
                    {VERB[item.type] ?? ""}
                  </p>
                  {item.preview ? (
                    <p className="st-text-muted mt-0.5 line-clamp-2 text-sm">
                      {item.preview}
                    </p>
                  ) : null}
                  <p className="st-text-muted mt-1 text-xs">
                    {timeAgo(item.createdAt)}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
