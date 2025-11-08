const formData = require("form-data");
const Mailgun = require("mailgun.js");

const mg = new Mailgun(formData);
const client = mg.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY,
});

exports.sendContactEmail = async ({ email, message }) => {
  try {
    const data = {
      from: process.env.EMAIL_FROM,
      to: process.env.ADMIN_EMAIL,
      subject: "A Message to Gigs Tech",
      text: `From: ${email}\n\nMessage:\n${message}`,
    };

    const result = await client.messages.create(process.env.MAILGUN_DOMAIN, data);
    console.log("Mailgun sent:", result);
    return result;
  } catch (err) {
    console.error("Mailgun error:", err);
    throw err;
  }
};
