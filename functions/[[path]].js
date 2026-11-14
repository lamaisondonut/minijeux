import { handleRequest } from "../server/api.mjs";
async function onRequest(context) {
  if (new URL(context.request.url).pathname.startsWith("/api/")) return handleRequest(context.request, context.env);
  return context.next();
}
export {
  onRequest
};
