# GitHub to Academy

This repository contains a GitHub Action to push markdown files to [Jahia Academy](https://academy.jahia.com/).

## Usage

We recommend using this action in two workflows:

- On release
- On manual trigger

```yaml
# .github/workflows/push-docs.yml
name: Push Docs to the Academy

on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  push-docs:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v5

      - uses: Jahia/github-to-academy@v1
        with:
          files: docs/**/*.md
          graphql-endpoint: ${{ secrets.ACADEMY_ENDPOINT }}
          graphql-authorization: ${{ secrets.ACADEMY_AUTHORIZATION }}
```

### Writing markdown files

The most basic use case for this action is mapping one markdown file to one JCR node:

```md
---
# The frontmatter contains metadata for the academy
content:
  # The path to the node in the JCR, mandatory
  $path: /sites/academy/home/...
  # Type of the node, defaults to "jacademy:textContent"
  $type: jnt:bigText
  # The name of the prop that holds the HTML content,
  # defaults to "textContent" if unset, mandatory for custom node types
  $body: text
  # All non $-prefixed properties will be passed as-is to create/update the node
  # Note that mandatory properties must be set
  'jcr:title': My Title
  ...: ...
---

## Write markdown here!

This file will be converted to HTML and pushed to the `text` property of the big text node type.
```

In the specific case of the academy, we usually want to map one markdown file to one academy page, which requires creating/updating many nodes at once. For now, the action supports creating one parent node (usually the page) for the content node (that usually lives in an area).

The markdown frontmatter can be extended to contain the details of the parent page:

```md
---
# This "page" section describes the parent node to create/update
page:
  # Path to the page in the JCR
  $path: /sites/academy/home/...
  # Node type of the page, defaults to "jnt:page"
  $type: jnt:page
  # All other properties will be passed as-is to create/update the page node
  # Note that mandatory properties must be set (mandatory props for "jnt:page":)
  'jcr:title': Page title
  'j:templateName': documentation

# The content node stays *almost* the same
content:
  # Where to create/update the content node, relative to the page (replaces $path)
  $subpath: document-area/content
  # The rest of the section stays the same
  $type: jnt:bigText
  $body: text
  ...other props...: will be passed as-is to create/update the content node
---

I'm a happy markdown document!
```

Other top-level properties can be set in the frontmatter to override default values for one specific document:

```md
---
# The default value is "en", but the node(s) can be pushed in another language
language: fr

# Enforce or prevent publication for individual pages
publish: false

# Take ownership of nodes that were not created by this action (see
# "Overwrite protection" below). Defaults to false.
overwrite: true
---
```

### Overwrite protection

Every node created by this action is stamped with a `githubToAcademyManaged` marker
property (carried by the `jmix:unstructured` mixin). On update:

- **Marker present** — the node is managed from GitHub, the update proceeds.
- **Marker absent** — the node holds content that was *not* pushed by this action
  (e.g. a page maintained by editors directly in Jahia). The update is **refused**
  with an explicit error, so a misconfigured `$path` cannot silently destroy Academy
  content.

To intentionally take over such a node, add `overwrite: true` to the top-level
frontmatter of the document. The first successful push then stamps the marker, so the
flag can (and should) be removed afterwards.

> **Migrating existing content**: nodes pushed by versions of this action that predate
> the marker carry no marker either — their documents need one push with
> `overwrite: true` to adopt them.

### Unchanged documents and pending publication

The action also stores a fingerprint of the values it pushes on each node, in a
`githubToAcademyFingerprint_<language>` property. When a document has not changed since
the last push, the action does not write its nodes again. A document that was published
then stays published. The `Pushed at` comment at the top of the body is not part of the
fingerprint, because it changes on every push.

After it pushes a document, the action reads the publication status of its content node
and of its page, and logs the document on a single line. Whether the document is live
depends on its content node alone: the page can hold other content that the action does
not manage.

- `✅ Pushed "<file>"`: the push succeeded, and the live site shows the content.
- `✅ Pushed "<file>" - 📝 Needs publishing in the Academy`: the push succeeded, and the
  content is in the edit mode of the Academy, but not on the live site yet. Someone must
  publish it in the Academy.
- `✅ Pushed "<file>" - ❔ Publication status unknown`: the push succeeded, but the action
  could not read the status.

The link of the status table below opens the page in jContent on the Academy edit server:
`https://edit.jahia.com/jahia/jcontent/<site>/<language>/pages/<path>`, where `<path>` is
the JCR path of the page without `/sites/<site>/`, such as `home/documentation/…`.

At the end of the run, the action logs how many documents need publishing, and
a collapsed group, "📋 Publication status of the pushed file(s)", with a table of every
pushed file: its language, the status of its page and of its content, whether the live
site is up to date, and the jContent link. A status is a value of the `PublicationStatus`
GraphQL enum, such as `NOT_PUBLISHED` for a new node or `MODIFIED` for a change. A
document with no page shows `-` in the page column.

The first push after an upgrade to this version writes every document once more, to
store its fingerprint.

### Links to other Academy pages

A link to an Academy page is the JCR path of the page followed by `.html`, such as
`/sites/academy/home/documentation/jahia-cloud/latest/environment/upgrade-your-environment.html`.
Jahia refuses a link to a path that it cannot resolve, and the push of the document fails
with `Invalid link`. The action then logs a hint that names the link, and gives the
corrected link when only `.html` is missing.

### Additional markdown transformations

All standard markdown syntax is supported, [with some additional features added to better support the academy.](./src/markdown.ts)

- Image tags with a relative path are rewritten to point to the GitHub raw URL, relative to the markdown file. This only works with public GitHub repos!

  <!-- prettier-ignore -->
  ```md
  <!-- Before -->
  ![alt text](relative.png)

  <!-- After -->
  <img src="https://raw.githubusercontent.com/username/repo/branch/docs/relative.png" alt="alt text" />
  ```

- [Bootstrap alerts](https://getbootstrap.com/docs/5.3/components/alerts/) have a custom markdown syntax:

  <!-- prettier-ignore -->
  ```md
  <!-- Before -->
  :::warning
  Be careful!
  :::

  <!-- After -->
  <div class="alert alert-warning">
  <p>Be careful!</p>
  </div>
  ```

  Supported types are: `success` (green), `danger` (red), `warning` (yellow) and `info` (blue).

- Code blocks are trimmed and TypeScript language identifiers (`ts`, `tsx`) are replaced with `js` in the output to be compatible with the list of languages supported by the [hl.js](https://github.com/Jahia/jahia-academy-template/blob/master/src/main/resources/javascript/highlight.min.js) copy of the academy.

- Tables are supported using the [GitHub Flavored Markdown syntax](https://github.github.com/gfm/#tables-extension-).

- CMS links (links starting with `/cms/{mode}/{lang}` or `/files/{workspace}`) are supported, and will use the correct vanity URL.

## Contributing

Contributions are welcome!

This repository is a [JavaScript Action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action).

The `main` branch is the development branch, it does not contain the build _artifact_ (a JS bundle), and therefore cannot be used directly as an action. All commits to the `main` branch will trigger a workflow to build the action and publish it to the `v1` branch.

Because the project is meant to run on GitHub, it currently does not have a local development environment. However, for "reproducible" parts, there are unit tests that can be run with `yarn test`.

```bash
# Install dependencies
yarn install

# Run tests
yarn test
```

If you want to try out changes before opening a PR, the best approach is to fork the repository and use `<you>/github-to-academy@v1` in your workflow.
