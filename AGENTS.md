# Agent Guidelines for agy-babysitter

## Deployment Rule
- Whenever a code change, feature, or bugfix is completed, always re-deploy the changes by running:
  ```bash
  npm run deploy
  ```
- Verify that the systemd service is active and running cleanly with `npm run status`.
