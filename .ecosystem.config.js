module.exports = {
    apps: [
      {
        name: "backend",
        script: "server.js",
        cwd: "/home/ec2-user/backend",
        env: {
          NODE_ENV: "development",
        },
        env_staging: {
          NODE_ENV: "staging",
        },
        env_production: {
          NODE_ENV: "production",
        },
      },
    ],
};
  