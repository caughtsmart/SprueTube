import { useEffect, useRef, useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/compose";
import { api, ApiError, uploadImage } from "../lib/api";
import { getScope } from "../lib/data.server";
import {
  GAME_SYSTEMS,
  GAME_SYSTEM_LABELS,
  MAX_BODY_LENGTH,
  MAX_IMAGES_PER_POST,
  SCALES,
  WIP_STAGES,
  WIP_STAGE_LABELS,
} from "../lib/taxonomy";

export function meta() {
  return [
    { title: "New post — SprueTube" },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  if (!scope.viewer) throw redirect("/login?next=/compose");
  if (!scope.viewer.profile.birthdate) throw redirect("/welcome");

  const projects = await scope.db.query.project.findMany({
    where: (p, { eq }) => eq(p.ownerId, scope.viewer!.userId),
    orderBy: (p, { desc }) => desc(p.updatedAt),
    limit: 50,
  });

  return {
    projects: projects.map((p) => ({ id: p.id, title: p.title })),
    shopName: scope.env.SHOP_NAME,
  };
}

type PendingImage = {
  key: string;
  file: File;
  previewUrl: string;
  imageId?: string;
  altText: string;
  width?: number;
  height?: number;
  progress: number;
  error?: string;
};

export default function Compose({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const imageInput = useRef<HTMLInputElement>(null);

  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);

  const [gameSystem, setGameSystem] = useState("");
  const [scale, setScale] = useState("");
  const [wipStage, setWipStage] = useState("");
  const [projectId, setProjectId] = useState("");

  /*
   * The build-log link opens in a new tab so a half-written post is not thrown
   * away to go and make one. That leaves this list stale when they come back,
   * so it refreshes on focus — otherwise someone creates a log, returns, and
   * finds the dropdown still telling them they have none.
   */
  const [projects, setProjects] = useState(loaderData.projects);
  useEffect(() => {
    async function refresh() {
      try {
        const { projects: fresh } = await api.get<{
          projects: { id: string; title: string }[];
        }>("/projects");
        setProjects(fresh.map((p) => ({ id: p.id, title: p.title })));
      } catch {
        // A stale list is survivable; an error here is not worth showing.
      }
    }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const [sensitive, setSensitive] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "followers">("public");
  const [paints, setPaints] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind: "text" | "images" = images.length ? "images" : "text";

  async function onPickImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(
      0,
      MAX_IMAGES_PER_POST - images.length,
    );
    event.target.value = "";
    if (!files.length) return;

    const pending: PendingImage[] = files.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      altText: "",
      progress: 0,
    }));

    setImages((current) => [...current, ...pending]);

    // Upload straight away rather than on submit. By the time someone has
    // written a caption, the photos are already on Cloudflare and posting is
    // instant — which is what makes it feel like a phone app.
    await Promise.all(
      pending.map(async (item) => {
        try {
          const result = await uploadImage(item.file, "post", (fraction) =>
            setImages((current) =>
              current.map((image) =>
                image.key === item.key
                  ? { ...image, progress: fraction }
                  : image,
              ),
            ),
          );
          setImages((current) =>
            current.map((image) =>
              image.key === item.key
                ? { ...image, ...result, progress: 1 }
                : image,
            ),
          );
        } catch {
          setImages((current) =>
            current.map((image) =>
              image.key === item.key
                ? { ...image, error: "Upload failed. Remove and try again." }
                : image,
            ),
          );
        }
      }),
    );
  }

  const uploadsPending = images.some(
    (image) => !image.imageId && !image.error,
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (uploadsPending) return;

    setSubmitting(true);
    setError(null);

    const products = paints
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((name) => ({ kind: "paint" as const, name, shopUrl: null }));

    try {
      const result = await api.post<{ id: string }>("/posts", {
        kind,
        title: title.trim() || null,
        body: body.trim() || null,
        gameSystem: gameSystem || null,
        scale: scale || null,
        wipStage: wipStage || null,
        projectId: projectId || null,
        visibility,
        sensitive,
        products,
        images: images
          .filter((image) => image.imageId)
          .map((image) => ({
            imageId: image.imageId!,
            width: image.width,
            height: image.height,
            altText: image.altText.trim() || undefined,
          })),
      });

      navigate(`/posts/${result.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (Object.values(caught.fields ?? {})[0] ?? caught.message)
          : "Could not post that. Try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">What is on the workbench?</h1>

      <form onSubmit={onSubmit} className="st-card space-y-4 p-4 sm:p-5">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          maxLength={MAX_BODY_LENGTH}
          className="st-input resize-y text-base"
          placeholder="Halfway through the Death Guard. Still not happy with the rust. #warhammer40k"
          aria-label="Post text"
        />

        {/* Media */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => imageInput.current?.click()}
            disabled={images.length >= MAX_IMAGES_PER_POST}
            className="st-btn st-btn-ghost text-sm"
          >
            📷 Add photos
          </button>
          <span className="st-text-muted self-center text-xs">
            Up to {MAX_IMAGES_PER_POST}
          </span>
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onPickImages}
          />
        </div>

        {images.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((image) => (
              <li key={image.key} className="st-border rounded-lg border p-2">
                <div className="relative">
                  <img
                    src={image.previewUrl}
                    alt=""
                    className="aspect-square w-full rounded object-cover"
                  />
                  {image.progress < 1 && !image.error ? (
                    <div className="absolute inset-x-0 bottom-0 h-1 rounded-b bg-black/50">
                      <div
                        className="h-full bg-[var(--color-primer-500)]"
                        style={{ width: `${Math.round(image.progress * 100)}%` }}
                      />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      setImages((current) =>
                        current.filter((item) => item.key !== image.key),
                      )
                    }
                    aria-label="Remove photo"
                    className="absolute top-1 right-1 rounded-full bg-black/70 px-2 py-0.5 text-xs text-white"
                  >
                    ✕
                  </button>
                </div>

                {/*
                  Alt text sits next to the photo rather than behind a menu.
                  Plenty of people on this site use screen readers, and a
                  miniature photo with no description is just "image".
                */}
                <input
                  value={image.altText}
                  onChange={(event) =>
                    setImages((current) =>
                      current.map((item) =>
                        item.key === image.key
                          ? { ...item, altText: event.target.value }
                          : item,
                      ),
                    )
                  }
                  maxLength={400}
                  placeholder="Describe it (alt text)"
                  className="st-input mt-2 text-xs"
                  aria-label="Alt text for this photo"
                />
                {image.error ? <p className="st-error">{image.error}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          Deliberately not an accordion.

          The stage picker is the one field that makes this site different from
          any other photo feed: "primed" and "three washes in" are what a build
          log is made of. Folded behind a summary, most people never opened it,
          and the posts arrived as bare photographs like everywhere else.
        */}
        <section className="st-border rounded-lg border p-3">
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="st-hazard-tag" />
            <h2 className="text-sm font-medium">Where is it up to?</h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Game or subject" htmlFor="gameSystem">
              <select
                id="gameSystem"
                value={gameSystem}
                onChange={(event) => setGameSystem(event.target.value)}
                className="st-input"
              >
                <option value="">Not specified</option>
                {GAME_SYSTEMS.map((system) => (
                  <option key={system} value={system}>
                    {GAME_SYSTEM_LABELS[system]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Scale" htmlFor="scale">
              <select
                id="scale"
                value={scale}
                onChange={(event) => setScale(event.target.value)}
                className="st-input"
              >
                <option value="">Not specified</option>
                {SCALES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Stage" htmlFor="wipStage">
              <select
                id="wipStage"
                value={wipStage}
                onChange={(event) => setWipStage(event.target.value)}
                className="st-input"
              >
                <option value="">Not specified</option>
                {WIP_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {WIP_STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </Field>

            {/*
              Someone with no build logs cannot be asked to pick one. Explaining
              what they are at the moment the question comes up is the only time
              the answer is actually useful — a link on a settings page is not
              where anyone reads it.
            */}
            {projects.length ? (
              <Field label="Add to a build log" htmlFor="projectId">
                <select
                  id="projectId"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="st-input"
                >
                  <option value="">Not part of one</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
                <p className="st-text-muted mt-1 text-xs">
                  Keeps this post with the rest of that build, oldest first.{" "}
                  <a
                    href="/projects/new"
                    target="_blank"
                    rel="noopener"
                    className="st-link"
                  >
                    Start another
                  </a>
                  .
                </p>
              </Field>
            ) : (
              <div className="sm:col-span-2">
                <span className="st-label">Build log</span>
                <div className="st-well mt-1 rounded-md p-3">
                  <p className="text-sm leading-relaxed">
                    A build log keeps one army, one model, or one long-running
                    project together on its own page — read oldest first, so the
                    bare plastic is still there at the top when the thing is
                    finished.
                  </p>
                  <p className="st-text-muted mt-2 text-xs">
                    You have not started one yet. This post is fine on its own;
                    you can always add it to a log later.
                  </p>
                  <a
                    href="/projects/new"
                    target="_blank"
                    rel="noopener"
                    className="st-btn st-btn-ghost mt-3 text-sm"
                  >
                    Start a build log ↗
                  </a>
                </div>
              </div>
            )}

            <div className="sm:col-span-2">
              <Field label="Paints and kit used" htmlFor="paints">
                <textarea
                  id="paints"
                  value={paints}
                  onChange={(event) => setPaints(event.target.value)}
                  rows={2}
                  className="st-input resize-y"
                  placeholder="Mephiston Red, Nuln Oil, Agrax Earthshade"
                />
                <p className="st-text-muted mt-1 text-xs">
                  One per line or separated by commas. These show under your
                  photo so nobody has to ask.
                </p>
              </Field>
            </div>
          </div>
        </section>

        {/* Visibility and flags */}
        <div className="flex flex-wrap items-center gap-4">
          {/*
            "Blur as sensitive" told nobody what it was for. This hobby is full
            of gore that is entirely normal to paint and entirely unwelcome as a
            surprise on someone's phone at breakfast — naming the actual cases is
            the difference between a checkbox people use and one they ignore.
          */}
          <div className="w-full sm:w-auto">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(event) => setSensitive(event.target.checked)}
                className="accent-[var(--color-primer-500)]"
              />
              Blur this until someone taps it
            </label>
            <p className="st-text-muted mt-1 max-w-sm text-xs leading-relaxed">
              For gore, body horror and anything else people might not want
              appearing unannounced — heavy blood, exposed viscera, Nurgle rot,
              Slaanesh, bare figures. The photo still posts and still gets found;
              it just arrives blurred with a tap to reveal.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            Visible to
            <select
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as "public" | "followers")
              }
              className="st-input w-auto py-1 text-sm"
            >
              <option value="public">Everyone</option>
              <option value="followers">Followers only</option>
            </select>
          </label>
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="st-text-muted text-xs">
            {uploadsPending ? "Waiting for uploads to finish…" : `${body.length}/${MAX_BODY_LENGTH}`}
          </p>
          <button
            type="submit"
            disabled={
              submitting ||
              uploadsPending ||
              (kind === "text" && !body.trim())
            }
            className="st-btn st-btn-primary"
          >
            {submitting ? "Posting…" : "Post"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="st-label">
        {label}
      </label>
      {children}
    </div>
  );
}
