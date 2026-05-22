/**
 * Cognito CustomMessage trigger — only overrides forgot-password emails with a reset link.
 * Env: FRONTEND_BASE_URL (required for production; defaults to localhost for dev)
 */
export const handler = async (event) => {
  if (event.triggerSource === "CustomMessage_ForgotPassword") {
    const base = (process.env.FRONTEND_BASE_URL || "http://localhost:5173").replace(
      /\/+$/,
      ""
    );
    const email = event.request.userAttributes?.email || "";
    const code = event.request.codeParameter || "";
    const link = `${base}/reset-password?email=${encodeURIComponent(email)}&code=${code}`;

    event.response.emailSubject = "RushCord — Reset your password";
    event.response.emailMessage = `<p>Click the link below to reset your password (valid 1 hour):</p>
<p><a href="${link}">Reset password</a></p>
<p>If the button does not work, copy this URL:<br/>${link}</p>
<p>If you did not request this, ignore this email.</p>`;
  }

  return event;
};
