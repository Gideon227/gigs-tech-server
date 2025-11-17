const asyncHandler = require('../middleware/asyncHandler');
const contactService = require('../services/contact.service')

exports.handleContactForm = asyncHandler(async (req, res, next) => {
  try {
    const { email, message } = req.body;

    if (!email || !message) {
      return res.status(400).json({ error: "Email and message are required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid email address." 
      });
    }

    await contactService.sendContactEmail({ email, message });

    return res.status(200).json({ message: "Message sent successfully!" });
  } catch (error) {
    console.error("Contact route error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send message. Please try again later." 
    });
  }
})