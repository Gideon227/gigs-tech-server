const nodemailer = require("nodemailer");

exports.sendContactEmail = ({ email, message }) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"Gigs Tech" <${process.env.EMAIL_USER}>`,
    to: process.env.ADMIN_EMAIL, // Send to admin
    subject: "A Message To Gigs Tech",
    text: `From: ${email}\n\nMessage:\n${message}`,
  };

  return transporter.sendMail(mailOptions);
}