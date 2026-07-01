import { getEnv } from "@/lib/env";

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
  const uploadUrl = `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${input.path}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": input.contentType,
      "x-upsert": "true",
    },
    body: new Uint8Array(input.body),
  });

  if (!response.ok) {
    throw new Error(`Supabase document upload failed: ${await response.text()}`);
  }

  const signedUrl = `${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${input.path}`;
  const signed = await fetch(signedUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 14 }),
  });

  if (!signed.ok) return `supabase://${bucket}/${input.path}`;
  const data = (await signed.json()) as { signedURL?: string; signedUrl?: string };
  const path = data.signedURL ?? data.signedUrl;
  return path ? `${env.SUPABASE_URL}/storage/v1${path}` : `supabase://${bucket}/${input.path}`;
}
