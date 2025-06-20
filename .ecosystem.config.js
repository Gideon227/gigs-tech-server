module.exports = {
    apps: [
      {
        name: "backend",
        script: "dist/main.js",
        cwd: "/home/ec2-user/backend",
        env: {
          NODE_ENV: "staging",
        },
      },
    ],
  };
  