import { requireAdmin } from "../server/auth.mjs";
import { json } from "../server/common.mjs";
async function onRequest(context) {
  let path;
  try {
    path = decodeURIComponent(new URL(context.request.url).pathname);
  } catch {
    return json({ error: "invalid_path" }, 400);
  }
  if (/^\/(?:admin(?:\/|$)|v3\/admin(?:[./]|$))/.test(path)) {
    try {
      await requireAdmin(context.request, context.env);
    } catch (error) {
      return json({ error: error.code || "access_denied", message: error.message || "Acc\xE8s r\xE9serv\xE9 aux employ\xE9s autoris\xE9s." }, error.status || 403);
    }
  }
  const response = await context.next();
  if (path.startsWith("/api/") || path.startsWith("/admin") || path.startsWith("/v3/admin")) {
    const secured = new Response(response.body, response);
    secured.headers.set("Cache-Control", "no-store");
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("Referrer-Policy", "same-origin");
    return secured;
  }
  return response;
}
export {
  onRequest
};
