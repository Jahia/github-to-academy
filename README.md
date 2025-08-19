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

## Contributing

Contributions are welcome!

This repository is a [JavaScript Action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action).

The `main` branch is the development branch, it does not contain the build _artifact_ (a JS bundle), and therefore cannot be used directly as an action. All commits to the `main` branch will trigger a workflow to build the action and publish it to the `v1` branch.
