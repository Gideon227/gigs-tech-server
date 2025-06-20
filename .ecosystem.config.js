module.exports = {
    apps: [
      {
        name: "backend",
        script: "server.js",
        cwd: "/home/ec2-user/backend",
        env: {
          NODE_ENV: "staging",
        },
      },
    ],
  };
  