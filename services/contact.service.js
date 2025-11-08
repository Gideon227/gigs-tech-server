const nodemailer = require("nodemailer");
const logger = require("../config/logger");

exports.sendContactEmail = async ({ email, message }) => {
  try {
    // Log configuration (without password)
    console.log("SMTP Configuration:", {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER,
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
    });

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Add these for debugging
      debug: true,
      logger: true,
    });

    // Verify connection
    await transporter.verify();
    console.log("SMTP connection verified successfully");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border-radius: 10px; border: 1px solid #eee; padding: 20px; background-color: #fafafa;">
        <h2 style="color: #0d9488;">📩 New Contact Message</h2>
        <p style="font-size: 16px;"><strong>Email:</strong> ${email}</p>
        <p style="font-size: 16px;"><strong>Message:</strong></p>
        <div style="white-space: pre-line; background:#fff; padding:10px; border-radius:8px; border:1px solid #ddd;">${message}</div>
        <hr style="margin-top:20px; border:none; border-top:1px solid #ddd;" />
        <p style="color:#777; font-size: 13px;">Sent from <a href="https://gigs.tech" style="color:#0d9488; text-decoration:none;">Gigs Tech</a> contact form.</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      subject: `New Contact Message: ${subject || "No subject"}`,
      html,
      replyTo: email, // Add reply-to for convenience
    });

    console.log("Email sent successfully:", info.messageId);
    logger?.info?.(`Contact email sent successfully from ${email}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("Detailed error:", {
      message: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
    });
    logger?.error?.("Error sending contact email", err);
    throw new Error(`Failed to send contact message: ${err.message}`);
  }
};