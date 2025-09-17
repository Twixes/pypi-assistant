# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension called "Python PyPI Assistant" that provides PyPI package information for Python dependencies. It displays package metadata (name, description, author, license, latest version) via hover tooltips, CodeLens, and version completion for various Python dependency formats.

## Development Commands

### Build and Test

-   `npm run build` - Build both desktop and web versions of the extension
-   `npm run build-desktop` - Build desktop version only (Node.js)
-   `npm run build-web` - Build web version only (browser)
-   `npm run test` - Run Jest tests
-   `npm run pretest` - Runs linting before tests (automatically called by test)

### Code Quality

-   `npm run lint` - Run ESLint on TypeScript files
-   `npm run format` - Format code with Prettier
-   `npm run type-check` - TypeScript type checking without emitting files

### Development Workflow

-   `npm run vscode:prepublish` - Prepare for publishing (runs build)
-   Use VS Code's "Run Extension" (F5) to test the extension in a new Extension Development Host window

## Architecture

### Core Components

**Extension Entry Point (`src/extension.ts`)**

-   Activates on `pip-requirements` and `toml` language files
-   Registers three main providers: HoverProvider, CodeLensProvider, CompletionItemProvider
-   Creates instances of RequirementsParser and PyPI classes

**Requirements Parser (`src/parsing/`)**

-   `RequirementsParser` - Main parser class with LRU caching for parsed requirements
-   `requirements.ts` - Parses pip requirements files using `pip-requirements-js`
-   `pyproject.ts` - Parses pyproject.toml files using `toml-eslint-parser` with visitor pattern
-   Supports multiple dependency formats: Poetry, PEP 631/735, uv, Pixi, build-system

**PyPI Integration (`src/pypi.ts`)**

-   `PyPI` class handles fetching package metadata from PyPI API
-   Uses `wretch` HTTP client with caching layer
-   Handles errors (404 for missing packages, network issues)

**VS Code Providers**

-   `PyPIHoverProvider` - Shows package info on hover
-   `PyPICodeLensProvider` - Shows latest version above dependency lines
-   `PyPICompletionItemProvider` - Version completion with complex operator handling

### Supported Dependency Formats

-   pip requirements files (`requirements.txt`, `requirements.in`, etc.)
-   Poetry dependencies in `pyproject.toml`
-   PEP 631 project dependencies
-   PEP 735 dependency groups
-   PEP 518 build-system requirements
-   uv constraint/dev/override dependencies
-   Pixi pypi-dependencies

### Key Dependencies

-   `pip-requirements-js` - Parsing pip requirement strings
-   `toml-eslint-parser` - TOML parsing with AST traversal
-   `wretch` - HTTP client for PyPI API calls
-   `semver` - Version sorting and validation
-   `dayjs` - Date formatting for release dates
-   `lru-cache` - Caching parsed requirements

## Testing

Tests are written in Jest and located in `src/parsing/*.test.ts`. The test suite covers:

-   Requirements parsing from pip files
-   pyproject.toml dependency extraction
-   Various dependency format edge cases

Run tests with `npm test` (includes linting) or `jest` directly.

Note that `outputChannel` logs aren't visible in Jest tests. `console.log()` should be instrumented to debug Jest tests.

## Extension Configuration

Users can disable CodeLens via `pypiAssistant.codeLens` setting (enabled by default).

## Build Targets

The extension supports both desktop (Node.js) and web (browser) environments:

-   Desktop version uses Node.js APIs and full feature set
-   Web version is minified and uses browser-compatible polyfills (`wretch-polyfills.ts`)
