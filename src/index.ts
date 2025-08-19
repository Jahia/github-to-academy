import * as core from '@actions/core';
import * as github from '@actions/github';
import { globSync } from 'node:fs';

try {
  const fileGlob = core.getInput('files', { required: true });

  const files = globSync(fileGlob);

  core.info(`Files found: ${files.join(', ')}`);

  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2);
  core.info(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed(error.message);
}
