import { data, Link, redirect } from "react-router";
import type { Route } from "./+types/conversation";
import { Avatar } from "../components/Avatar";
import { MessageThread } from "../components/MessageThread";
import { getScope } from "../lib/data.server";
import { imageSrc } from "../lib/media";
import { getThread, listMessages } from "../../server/services/messaging";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  return [
    {
      title: loaded?.other
        ? `${loaded.other.displayName} — Messages — SprueTube`
        : "Messages — SprueTube",
    },
    // Private by definition. Nothing on this page should ever be indexed.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) {
    throw redirect(
      `/login?next=${encodeURIComponent(`/messages/${params.conversationId}`)}`,
    );
  }

  /*
   * The id in the URL is a lookup key and nothing more. getThread resolves the
   * conversation, checks the viewer is one of the two people in it, and checks
   * that neither has blocked the other — all three failures come back as the
   * same null, and the same 404, so this page cannot be used to find out that
   * a thread exists.
   */
  const thread = await getThread(
    scope.db,
    params.conversationId,
    scope.viewer.userId,
  );
  if (!thread) throw data({ message: "No such conversation." }, { status: 404 });

  const page = await listMessages(
    scope.db,
    params.conversationId,
    scope.viewer.userId,
  );

  const config = { imagesAccountHash: scope.env.CF_IMAGES_ACCOUNT_HASH };

  return {
    conversationId: thread.conversation.id,
    viewerId: scope.viewer.userId,
    other: thread.other,
    avatarUrl: imageSrc(config, thread.other.avatarImageId, "avatar"),
    messages: page?.messages ?? [],
    nextCursor: page?.nextCursor ?? null,
  };
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
  const { other } = loaderData;

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <header className="st-border flex items-center gap-3 border-b pb-3">
        <Link to="/messages" className="st-text-muted text-sm" aria-label="Back to messages">
          ←
        </Link>
        <Link to={`/@${other.username}`} className="flex items-center gap-2">
          <Avatar
            username={other.username}
            src={loaderData.avatarUrl}
            size={36}
          />
          <span>
            <span className="st-text-strong block text-sm font-semibold">
              {other.displayName}
            </span>
            <span className="st-text-muted block text-xs">
              @{other.username}
            </span>
          </span>
        </Link>
      </header>

      <div className="mt-4">
        <MessageThread
          key={loaderData.conversationId}
          conversationId={loaderData.conversationId}
          viewerId={loaderData.viewerId}
          otherName={other.displayName}
          initialMessages={loaderData.messages}
          initialCursor={loaderData.nextCursor}
        />
      </div>

      <p className="st-text-muted mt-4 text-xs leading-relaxed">
        Messages are private between the two of you, but they are not encrypted
        and a moderator can read one that gets reported. SprueTube does not
        handle payments — arrange those between yourselves.
      </p>
    </div>
  );
}
