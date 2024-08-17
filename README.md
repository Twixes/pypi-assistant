# [PyPI Assistant for VS Code](https://marketplace.visualstudio.com/items?itemName=twixes.pypi-assistant)

Handy hover tooltips + CodeLens for dependencies from PyPI – similar to what VS Code has built in for dependencies in `package.json`.

Gain access to: package name, description, author(s), license, and latest version at a glance, with links in case you need more details.

![Extension preview](preview.png)

Supported formats:

-   [pip requirements files](https://pip.pypa.io/en/stable/user_guide/#requirements-files) – `requirements.txt`, `constraints.txt`, and such
-   [Poetry](https://python-poetry.org/docs/pyproject/#dependencies-and-dependency-groups) – `tool.poetry.dependencies` in `pyproject.toml`
-   [PEP 631](https://peps.python.org/pep-0631/) – `project.dependencies` in `pyproject.toml`

This extension depends on [Microsoft's official Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) for `pip requirements` language detection.
