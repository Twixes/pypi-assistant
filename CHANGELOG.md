# Changelog

## [2.0.0]

### Added

-   Support for Poetry dependencies specified in `pyproject.toml`! Thanks to [@alex-way](https://github.com/alex-way) for contributing in [#10](https://github.com/Twixes/pypi-assistant/pull/25).

## [1.2.4]

### Fixed

-   Fixed CodeLens not appearing for files containing non-project lines (e.g. comment-only).

## [1.2.3]

### Changed

-   [pip-requirements-js](https://github.com/Twixes/pip-requirements-js)'s loose parsing mode is used instead of full parsing, which means better tolerance for partially-written requirements.

## [1.2.0]

### Fixed

-   You should no longer see "!!!MISSING: command!!!", which appeared on lines containing previously unsupported syntax (such as `-r requirements.txt` specs). This is the result of parsing having switched from an internal regular expression to the [pip-requirements-js](https://github.com/Twixes/pip-requirements-js) library, which has proper support for the whole requirements file syntax.

## [1.1.3]

### Fixed

-   Version specs with wildcards, such as `bcrypt==4.0.*`, are now properly recognized. Contributed by [@a-was](https://github.com/a-was). Thanks!

## [1.1.2]

### Changed

-   The extension is now bundled into a single file. This gets us closer to working in online VS Code environments, such as GitHub Codespaces.

## [1.1.0]

### Added

-   CodeLens support: latest package version shown directly in the editor! Enabled by default, but can be disabled in VS Code settings. Contributed by [@elliotwutingfeng](https://github.com/elliotwutingfeng). Thanks!

## [1.0.4]

### Changed

-   Tuned regexes for improved requirements parsing.

## [1.0.3]

### Changed

-   Improved Marketplace configuration.

## [1.0.2]

### Fixed

-   Extension activation.

## [1.0.1]

### Added

-   Marketplace icon and theme.

## [1.0.0]

Initial release.
