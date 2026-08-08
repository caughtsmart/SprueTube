import { data, redirect } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/project-edit";
import { ProjectForm } from "../components/ProjectForm";
import { getScope } from "../lib/data.server";
import { useRoot } from "../root";
import { project } from "../../server/db/schema";
import type { ProjectStatus } from "../lib/taxonomy";

export function meta() {
  return [
    { title: "Edit build log — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) {
    throw redirect(`/login?next=/${params.handle}/projects/${params.slug}/edit`);
  }

  /*
   * Ownership is decided by the session, not by the handle in the URL. Looking
   * the project up by the viewer's own id means someone else's slug simply does
   * not resolve, rather than resolving and then being refused.
   */
  const entry = await scope.db.query.project.findFirst({
    where: and(
      eq(project.ownerId, scope.viewer.userId),
      eq(project.slug, params.slug),
    ),
  });
  if (!entry) {
    throw data({ message: "That build log is not yours." }, { status: 404 });
  }

  return {
    username: scope.viewer.profile.username,
    projectId: entry.id,
    initial: {
      title: entry.title,
      summary: entry.summary ?? "",
      gameSystem: entry.gameSystem ?? "",
      scale: entry.scale ?? "",
      status: entry.status as ProjectStatus,
      coverImageId: entry.coverImageId,
    },
  };
}

export default function EditProject({ loaderData }: Route.ComponentProps) {
  const { config } = useRoot();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Edit build log</h1>
      <ProjectForm
        config={config}
        initial={loaderData.initial}
        projectId={loaderData.projectId}
        username={loaderData.username}
      />
    </div>
  );
}
