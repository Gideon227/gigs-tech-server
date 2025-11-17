const sgMail = require("@sendgrid/mail");

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;
const SENDGRID_TO_EMAIL = process.env.SENDGRID_TO_EMAIL;

if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL || !SENDGRID_TO_EMAIL) {
  console.error("Missing SendGrid environment variables.");
}

sgMail.setApiKey(SENDGRID_API_KEY);

const sendContactEmail = async ({ email, message }) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border-radius: 10px; border: 1px solid #eee; padding: 20px; background-color: #fafafa;">
        <h2 style="color: #0d9488;">New Contact Message</h2>
        <p style="font-size: 16px;"><strong>Email:</strong> ${email}</p>
        <p style="font-size: 16px;"><strong>Message:</strong></p>
        <div style="white-space: pre-line; background:#fff; padding:10px; border-radius:8px; border:1px solid #ddd;">${message}</div>
        <hr style="margin-top:20px; border:none; border-top:1px solid #ddd;" />
        <p style="color:#777; font-size: 13px;">Sent from <a href="https://gigs.tech" style="color:#0d9488; text-decoration:none;">Gigs Tech</a> contact form.</p>
      </div>
    `;

    await sgMail.send({
      to: SENDGRID_TO_EMAIL,
      from: SENDGRID_FROM_EMAIL,
      subject: `New Contact Message`,
      html,
      text: `Email: ${email}\n\nMessage:\n${message}`,
      replyTo: email,
    });

    console.log(`Contact email sent successfully from: ${email}`);
  } catch (error) {
    console.error("SendGrid Error:", error.response?.body || error.message);
    throw new Error("Failed to send contact message.");
  }
};

module.exports = {
  sendContactEmail,
};
