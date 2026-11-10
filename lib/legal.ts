// lib/legal.ts (push 9, audit T13)
//
// The version of the Terms of Service and Privacy Policy an account accepts. Change it (to the date the
// terms changed) when either document changes in a way people should agree to again: every signed-in
// account whose accepted version differs is asked once more, by components/terms-gate.tsx.

export const TERMS_VERSION = "2026-11-10";

/** The words a person agrees to, kept in one place so the sign-up form and the gate say the same thing. */
export const TERMS_STATEMENT = "I am 18 or older, and I agree to the Terms of Service and the Privacy Policy.";
