import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type MerchantSession = {
  merchantId: string;
  shopDomain: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export function getSessionOptions(): SessionOptions {
  return {
    password: process.env.SESSION_SECRET!,
    cookieName: "checkout_merchant_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    },
  };
}

export async function getMerchantSession() {
  return getIronSession<MerchantSession>(await cookies(), getSessionOptions());
}

export async function requireMerchantSession() {
  const session = await getMerchantSession();
  if (!session.merchantId) {
    throw new UnauthorizedError();
  }
  return session;
}
