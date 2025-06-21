require('dotenv').config({ path: '.env.staging' });
module.exports = {
    apps: [
      {
        name: "backend",
        script: "server.js",
        cwd: "/home/ec2-user/backend",
        env: {
          NODE_ENV: "staging",
          PORT: 4000,
          DATABASE_URL: process.env.DATABASE_URL,
          REDIS_PORT: process.env.REDIS_PORT,
          REDIS_HOST: process.env.REDIS_HOST,
        },
      },
    ],
};
  