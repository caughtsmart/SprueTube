/*
 * Browser-side client for the SprueTube API.
 *
 * Same-origin and cookie-authenticated, so there is no token handling here.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;

  const response = await fetch(`/api/v1${path}`, {
    ...rest,
    credentials: "same-origin",
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);

  if (!response.ok) {
    const body = payload as {
      error?: string;
      message?: string;
      fields?: Record<string, string>;
    };
    throw new ApiError(
      response.status,
      body.error ?? "error",
      body.message ?? "Something went wrong.",
      body.fields,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "POST", json }),
  patch: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "PATCH", json }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/* -------------------------------------------------------------------------- */
/* Uploads                                                                    */
/* -------------------------------------------------------------------------- */

export type ImageTicket = { uploadUrl: string; imageId: string };

/**
 * Uploads straight to Cloudflare Images using a one-time ticket from our API.
 * The bytes never pass through the Worker.
 */
export async function uploadImage(
  file: File,
  purpose: "post" | "avatar" | "banner" | "cover" = "post",
  onProgress?: (fraction: number) => void,
): Promise<{ imageId: string; width: number; height: number }> {
  const { tickets } = await api.post<{ tickets: ImageTicket[] }>(
    "/uploads/images",
    { purpose, count: 1 },
  );
  const ticket = tickets[0];
  if (!ticket) throw new Error("No upload ticket returned.");

  const dimensions = await readImageDimensions(file).catch(() => ({
    width: 0,
    height: 0,
  }));

  const form = new FormData();
  form.append("file", file);

  await uploadWithProgress(ticket.uploadUrl, form, onProgress);

  return { imageId: ticket.imageId, ...dimensions };
}

/**
 * XHR rather than fetch purely for upload progress — a painter uploading eight
 * photos of a squad over home broadband needs to see something is happening.
 */
function uploadWithProgress(
  url: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Upload failed. Check your connection.")),
    );
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));

    xhr.send(form);
  });
}

function readImageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the image."));
    };
    image.src = url;
  });
}
