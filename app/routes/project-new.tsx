import { redirect } from "react-router";
import type { Route } from "./+types/project-new";
import { EMPTY_PROJECT, ProjectForm } from "../components/ProjectForm";
import { getScope } from "../lib/data.server";
import { useRoot } from "../root";

export function meta() {
  return [
    { title: "New build log — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/projects/new");
  if (!scope.viewer.profile.birthdate) throw redirect("/welcome");

  return { username: scope.viewer.profile.username };
}

export default function NewProject({ loaderData }: Route.ComponentProps) {
  const { config } = useRoot();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">New build log</h1>
      <p className="st-text-muted mb-4 text-sm">
        A place to keep one army, one model, or one long-running mistake
        together. You can add posts to it as you go.
      </p>

      <ProjectForm
        config={config}
        initial={EMPTY_PROJECT}
        username={loaderData.username}
      />
    </div>
  );
}
