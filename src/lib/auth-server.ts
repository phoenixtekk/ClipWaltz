import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
// Your project's Drizzle client + schema (schema must export user/session/account/verification).
import { db, schema } from "@/db";
import { sendEmail, simpleEmail } from "./email";

// Enable only the social providers whose credentials are present.
function buildSocialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  return providers;
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true",
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        html: simpleEmail("Reset your password", "Click below to choose a new password.", {
          label: "Reset password",
          url,
        }),
        text: `Reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true",
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your email",
        html: simpleEmail("Verify your email", "Confirm your email to finish signing up.", {
          label: "Verify email",
          url,
        }),
        text: `Verify your email: ${url}`,
      });
    },
  },
  user: {
    additionalFields: {
      // Example custom column; remove if your `user` table has no `plan`.
      plan: { type: "string", required: false, defaultValue: "free", input: false },
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  socialProviders: buildSocialProviders(),
  databaseHooks: {
    user: {
      create: {
        after: async (u) => {
          // Redeem any pending admin comp-invite for this email into a live grant.
          try {
            const { redeemInviteForEmail } = await import("./invites");
            await redeemInviteForEmail(u.email, u.id);
          } catch (e) {
            console.error("[invite] redeem on signup failed", e);
          }
        },
      },
    },
  },
  plugins: [nextCookies()], // nextCookies must be last
});
