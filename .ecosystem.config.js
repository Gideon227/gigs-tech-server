module.exports = {
  apps: [
    {
      name: "gigs-backend",
      script: "npm",
      args: "run start",
      cwd: "/var/www/gigs-tech/backend",
      env: {
        NODE_ENV: "development",
      },
      env_staging: {
        NODE_ENV: "staging",
      },
      env_production: {
        NODE_ENV: "production",
      },
      watch: false,
    },
  ],
};
