export function previewTestRedemption(env) {
  if(env.DEPLOYMENT_ENVIRONMENT!=='preview' || env.PREVIEW_TEST_REDEMPTION!=='true')return false;
  try {const u=new URL(env.APP_ORIGIN);return u.protocol==='https:' && /^[a-z0-9-]+\.minijeux-4gy\.pages\.dev$/.test(u.hostname) && u.origin===env.APP_ORIGIN;}catch{return false;}
}
