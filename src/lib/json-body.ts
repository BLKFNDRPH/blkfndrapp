/**
 * A request's JSON body when it is an object, or null when it is anything else:
 * not JSON at all, `null`, an array, a bare string or number.
 *
 * `const { x } = await req.json()` throws on the first and the second, and the
 * route's catch turned that into a 500 (the ZAP active scan found five routes
 * doing it). A route answers null from here with a 400. Call it after the
 * caller is authenticated, so a signed-out request is still refused with 401.
 */
export async function jsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
