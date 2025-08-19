# GitHub to Academy

This repository contains a GitHub Action to push markdown files to [Jahia Academy](https://academy.jahia.com/).

## Usage

We recommend using this action in two workflows:

- On release
- On manual trigger

```yaml
- uses: Jahia/github-to-academy@v1
  with:
    files: docs/**/*.md
    graphql-endpoint: https://example.com/modules/graphql
    graphql-authorization: Basic abcd... # Use a secret!
```

### Writing markdown files

The action maps one markdown file to a set of nodes in the JCR repository:

```
.md file  <=> jnt:page
              \-- area
                  \-- rich text
```

For now, only the page+area+rich text structure is supported.

Here is the expected structure of a markdown file:

```md
---
# The frontmatter contains metadata for the academy
language: en # The language of the content
publish: true # Optionnally enforce or prevent publication for individual pages

page:
  $path: /sites/academy/home/... # The path to the page in the jcr
  $type: jnt:page # The type of the page node, defaults to "jnt:page"
  $template: documentation # The name of the template to use, defaults to "documentation"
  ...other prop...: will be passed as-is to create/update the page node

content:
  $subpath: page-area/content # Where to create/update the content node under the page
  $type: jnt:richText # The type of the content node, defaults to "jnt:richText"
  $content: content # Name of the property that contains the rendered markdown
  ...other prop...: will be passed as-is to create/update the content node
---

Write _markdown_ here!
```

This should fit most if not all use cases. If the page contains the rendered markdown directly, the following structure is supported:

```md
---
# The frontmatter contains metadata for the academy
language: en # The language of the content
publish: true # Optionnally enforce or prevent publication for individual pages

page:
  $path: /sites/academy/home/... # The path to the page in the jcr
  $type: jnt:page # The type of the page node, defaults to "jnt:page"
  $template: documentation # The name of the template to use, defaults to "documentation"
  $content: content
  ...other prop...: will be passed as-is to create/update the page node
# The $content prop completely removed the need for a specific content node
---

Write _markdown_ here!
```

## Contributing

Contributions are welcome!

This repository is a [JavaScript Action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action).

The `main` branch is the development branch, it does not contain the build _artifact_ (a JS bundle), and therefore cannot be used directly as an action. All commits to the `main` branch will trigger a workflow to build the action and publish it to the `v1` branch.
