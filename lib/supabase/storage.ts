import { getEnv } from "@/lib/env";

async function ensureDocumentsBucket(env: ReturnType<typeof getEnv>, bucket: string) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: 10 * 1024 * 1024,
      allowed_mime_types: ["application/pdf"],
    }),
  });

  if (response.ok || response.status === 409) return;

  throw new Error(`Supabase bucket create failed: ${await response.text()}`);
}

async function uploadObject(input: {
  env: ReturnType<typeof getEnv>;
  bucket: string;
  path: string;
  contentType: string;
  body: Buffer;
}) {
  const uploadUrl = `${input.env.SUPABASE_URL}/storage/v1/object/${input.bucket}/${input.path}`;
  return fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: input.env.SUPABASE_SERVICE_ROLE_KEY!,
      "Content-Type": input.contentType,
      "x-upsert": "true",
    },
    body: new Uint8Array(input.body),
  });
}

export async function uploadPrivateDocument(input: {
  path: string;
  contentType: string;
  body: Buffer;
}) {
  const env = getEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return `mock://supabase/${input.path}`;
  }

  const bucket = env.SUPABASE_DOCUMENTS_BUCKET;
  let response = await uploadObject({
    env,
    bucket,
    path: input.path,
    contentType: input.contentType,
    body: input.body,
  });

  if (!response.ok) {
    const message = await response.text();
    if (response.status === 404 && message.includes("Bucket not found")) {
      await ensureDocumentsBucket(env, bucket);
      response = await uploadObject({
        env,
        bucket,
        path: input.path,
        contentType: input.contentType,
        body: input.body,
      });
      if (response.ok) {
        return createSignedDocumentUrl(env, bucket, input.path);
      }
      throw new Error(`Supabase document upload failed: ${await response.text()}`);
    }
    throw new Error(`Supabase document upload failed: ${message}`);
  }

  return createSignedDocumentUrl(env, bucket, input.path);
}

async function createSignedDocumentUrl(env: ReturnType<typeof getEnv>, bucket: string, path: string) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return `supabase://${bucket}/${path}`;

  const signedUrl = `${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`;
  const signed = await fetch(signedUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 14 }),
  });

  if (!signed.ok) return `supabase://${bucket}/${path}`;
  const data = (await signed.json()) as { signedURL?: string; signedUrl?: string };
  const signedPath = data.signedURL ?? data.signedUrl;
  return signedPath ? `${env.SUPABASE_URL}/storage/v1${signedPath}` : `supabase://${bucket}/${path}`;
}
