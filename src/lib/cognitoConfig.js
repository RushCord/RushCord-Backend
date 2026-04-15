/**
 * Cognito env required for auth API + JWT middleware.
 */
function getCognitoConfig() {
  const region = process.env.AWS_REGION || "ap-southeast-1";
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    throw new Error(
      "Missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID in environment"
    );
  }
  return {
    region,
    userPoolId,
    clientId,
    endpoint: process.env.COGNITO_ENDPOINT || undefined,
  };
}

module.exports = { getCognitoConfig };
