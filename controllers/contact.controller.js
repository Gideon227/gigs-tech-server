const asyncHandler = require('../middleware/asyncHandler');
const contactService = require('../services/contact.service')

exports.handleContactForm = asyncHandler(async (req, res, next) => {
  try {
    const { email, message } = req.body;

    if (!email || !message) {
      return res.status(400).json({ error: "Email and message are required" });
    }

    await contactService.sendContactEmail({ email, message });

    return res.status(200).json({ message: "Message sent successfully!" });
  } catch (error) {
    console.error("Contact form error:", error);
    next(error);
  }
})