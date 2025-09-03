# GitHub to Academy

This repository contains a GitHub Action to push markdown files to [Jahia Academy](https://academy.jahia.com/).

## Usage

We recommend using this action in two workflows:

- On release
- On manual trigger

```yaml
# .github/workflows/push-docs.yml
on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  push-docs:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v2

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
---
```

## Contributing

Contributions are welcome!

This repository is a [JavaScript Action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action).

The `main` branch is the development branch, it does not contain the build _artifact_ (a JS bundle), and therefore cannot be used directly as an action. All commits to the `main` branch will trigger a workflow to build the action and publish it to the `v1` branch.
