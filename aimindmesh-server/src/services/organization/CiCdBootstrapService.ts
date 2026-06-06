export class CiCdBootstrapService {
  generateWorkflow(template: 'node-webapp' | 'node-library' | 'docker-service' | 'tauri-desktop-app' | 'android-app' | 'static-site'): string {
    if (template === 'node-webapp') {
      return `name: CI
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
      - run: npm run build
`;
    }
    return `name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
  }
}
