import { requireAdmin } from "../server/auth.mjs";
import { json } from "../server/common.mjs";
function closedEmployeePage(status) {
  const title = status === 401 ? "Connexion requise" : status === 403 ? "Accès réservé au personnel autorisé" : "Accès au registre indisponible";
  return new Response(`<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} — Les Boréalistes</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#2D351E;color:#fff;font:16px/1.6 system-ui,sans-serif}main{max-width:32rem;margin:24px;padding:28px;border:1px solid #EFCD7A;border-radius:14px}h1{color:#EFCD7A;font-size:1.6rem}a{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:8px;background:#EFCD7A;color:#2D351E;font-weight:700;text-decoration:none}</style></head><body><main><p>LES BORÉALISTES · ESPACE EMPLOYÉS</p><h1>${title}</h1><p>Le registre des récompenses est accessible avec un compte individuel autorisé. Si l’accès demeure impossible, communiquez avec le responsable du restaurant.</p><a href="/admin/">Réessayer la connexion</a></main></body></html>`, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex, nofollow",
  } });
}
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
      return closedEmployeePage([401,403,503].includes(error.status) ? error.status : 403);
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
