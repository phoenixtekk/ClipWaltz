"use client";
import { createAuthClient } from "better-auth/react";

// baseURL defaults to the current origin — correct across local/staging/prod.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
