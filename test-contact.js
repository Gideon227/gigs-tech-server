require('dotenv').config();
const nodemailer = require('nodemailer');

async function test() {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    await transporter.verify();
    console.log('✅ SMTP connection verified');
    
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      subject: 'Test Contact Form',
      html: '<p>This is a test email from Gigs Tech contact form.</p>',
    });
    
    console.log('✅ Email sent:', info.messageId);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();