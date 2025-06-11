// middleware/notFoundHandler.js
module.exports = (req, res, next) => {
    res.status(404).json({
      status: 'fail',
      message: `Cannot find ${req.originalUrl} on this server`,
    });
};
  