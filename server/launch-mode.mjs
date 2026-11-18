// SMS verification stays available for a later, explicitly configured release.
// Launch does not depend on Twilio credentials, approval or message quotas.
export function phoneVerificationMode(env) {
  const mode = env.PHONE_VERIFICATION_MODE ?? 'unverified';
  return ['unverified', 'sms'].includes(mode) ? mode : null;
}
