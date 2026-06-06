module.exports = {
  apps: [{
    name: "aimindmesh-server",
    script: "./dist/index.js",
    env: {
      NODE_ENV: "production"
    }
  }]
}
