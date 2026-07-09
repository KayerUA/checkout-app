import { getEnv } from "@/lib/env";

export async function sendDocumentEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}) {
  const env = getEnv();
  if (!env.RESEND_API_KEY || !env.DOCUMENTS_FROM_EMAIL) {
    return { skipped: true, id: "mock-email" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.DOCUMENTS_FROM_EMAIL,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content.toString("base64"),
        content_type: attachment.contentType,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend email failed: ${await response.text()}`);
  }

  return (await response.json()) as { id?: string };
}
