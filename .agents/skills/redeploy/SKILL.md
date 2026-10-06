---
name: redeploy
description: >-
  Use this skill to compile and re-deploy agy-babysitter whenever a new feature, bugfix,
  or UI change is completed. It builds client and server artifacts into dist/ and restarts
  the systemd service.
---

# Re-deploy agy-babysitter

Use this procedure to deploy the latest changes to the running systemd service.

## Deployment Steps

1. **Run the Deploy Script**:
   Execute the deploy command from the repository root:
   ```bash
   npm run deploy
   ```
   *(This compiles `dist/client/`, copies `dist/server/`, and restarts `agy-babysitter.service`)*.

2. **Verify Service Health**:
   Check that the service restarted cleanly and is active:
   ```bash
   npm run status
   ```

3. **Check Logs (if issues arise)**:
   If the service fails to start or encounters an error, inspect recent journal logs:
   ```bash
   npm run logs -n 25
   ```
