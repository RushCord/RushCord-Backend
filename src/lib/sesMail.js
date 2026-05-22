const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

function sesClient() {
  const region = process.env.AWS_REGION || "ap-southeast-1";
  return new SESClient({ region });
}

function fromAddress() {
  const email = process.env.SES_FROM_EMAIL;
  if (!email) {
    throw new Error("SES_FROM_EMAIL is not set");
  }
  const name = process.env.SES_FROM_NAME || "RushCord";
  return `${name} <${email}>`;
}

/**
 * Send email-change confirmation link to the user's current (old) email.
 */
async function sendEmailChangeConfirmation({ toEmail, confirmUrl }) {
  const Source = fromAddress();
  const subject = "RushCord — Xác nhận đổi email";
  const html = `<p>Bạn đã yêu cầu đổi địa chỉ email cho tài khoản RushCord.</p>
<p>Bấm vào link bên dưới để xác nhận (hiệu lực 24 giờ):</p>
<p><a href="${confirmUrl}">Xác nhận đổi email</a></p>
<p>Nếu nút không hoạt động, copy URL sau:<br/>${confirmUrl}</p>
<p>Nếu bạn không yêu cầu đổi email, hãy bỏ qua email này và đổi mật khẩu ngay.</p>`;

  await sesClient().send(
    new SendEmailCommand({
      Source,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: html, Charset: "UTF-8" },
        },
      },
    })
  );
}

module.exports = { sendEmailChangeConfirmation };
