/**
 * Transient cookie holding an in-flight Google sign-in attempt: the nonce and
 * state we issued, plus where to send the user afterwards.
 *
 * Lives here rather than in the route module because Next.js route files may
 * only export route handlers and a fixed set of config keys — exporting
 * anything else fails the build.
 *
 * SameSite=None is required: Google returns the token via
 * response_mode=form_post, a cross-site POST, and a Lax cookie is not sent
 * with one.
 */
export const LOGIN_STATE_COOKIE = "google-login-state";

export interface LoginState {
  nonce: string;
  state: string;
  returnTo: string;
}

export const LOGIN_STATE_MAX_AGE_SECONDS = 60 * 10;
