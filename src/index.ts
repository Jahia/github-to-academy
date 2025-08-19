import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'node:fs';
import { read } from 'to-vfile';
import { toMarkdown } from './markdown.ts';

try {
  const glob = core.getInput('files', { required: true });
  const files = fs.globSync(glob);

  core.info(`Found ${files.length} markdown files from glob: "${glob}".`);

  for (const file of files) {
    try {
      const vfile = await read(file, { encoding: 'utf8' });
      vfile.data.raw = `https://raw.githubusercontent.com/${github.context.repo.owner}/${github.context.repo.repo}/${github.context.sha}/${file}`;
      const markdown = await toMarkdown(vfile);
      core.info(
        `Processed file: "${file}". Extracted data: ${JSON.stringify(markdown.data, null, 2)}`
      );
    } catch (error) {
      console.error(error);
      core.warning(`Failed to process file: "${file}".`);
    }
  }

  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2);
  core.info(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed(error.message);
}
