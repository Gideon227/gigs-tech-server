const nodemailer = require("nodemailer");

exports.sendContactEmail = ({ email, message }) => {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, // smtp.gmail.com
    port: Number(process.env.EMAIL_PORT), // 465
    secure: true,
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