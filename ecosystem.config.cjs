const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'demo-web',
      cwd: path.join(__dirname, 'apps/demo-web'),
      script: 'node_modules/next/dist/bin/next',
      args: ['start', '-H', '0.0.0.0'],
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
