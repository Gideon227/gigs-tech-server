const prisma = require('./config/prisma');
require('dotenv').config();

(async () => {
  try {
    const now = new Date();
    const cutoffTime = new Date(Date.now() - 36 * 60 * 60 * 1000);

    console.log("Now UTC:      ", now.toISOString());
    console.log("Cutoff UTC:   ", cutoffTime.toISOString());

    // Grab a recent job
    const job = await prisma.job.findFirst({
      orderBy: { updatedAt: 'desc' },
    });

    console.log("Sample job updatedAt (UTC):", job.updatedAt.toISOString());

    // Check comparison manually
    const isExpired = job.updatedAt < cutoffTime;
    console.log("Would this job expire?", isExpired);

    // Run the SQL condition that updateMany would run
    const jobsToExpire = await prisma.job.findMany({
      where: { updatedAt: { lt: cutoffTime } },
      select: { id: true, updatedAt: true },
    });

    console.log("Jobs that would expire:", jobsToExpire);

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
})();
