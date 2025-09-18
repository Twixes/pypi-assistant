# [Python PyPI Assistant for VS Code](https://marketplace.visualstudio.com/items?itemName=twixes.pypi-assistant)

Understand and upgrade your Python dependencies effortlessly. PyPI Assistant adds three key features to every `requirements.txt` and `pyproject.toml` file:

-   Hover tooltips on PyPI dependencies. All the key details, right in the editor – package description, author, license, and last release date, plus links.
-   CodeLens inline info. See the latest version at a glance.
-   Version completion suggestions. Specify the right constraints quickly, based on the package's actual release history.

![Extension preview](preview.png)

PyPI Assistant supports virtually all the requirements formats out there:

-   [pip requirements files](https://pip.pypa.io/en/stable/user_guide/#requirements-files) – `requirements.txt`, `requirements.in`, `constraints.txt`, and such
-   [Poetry](https://python-poetry.org/docs/pyproject/#dependencies-and-dependency-groups) – `pyproject.toml`'s `tool.poetry.dependencies`
-   [PEP 631](https://peps.python.org/pep-0631/) – `pyproject.toml`'s `project.dependencies`/`project.optional-dependencies`
-   [PEP 735](https://peps.python.org/pep-0735/) - `pyproject.toml`'s `dependency-groups`
-   [PEP 518](https://peps.python.org/pep-0517/) – `pyproject.toml`'s `build-system.requires`
-   [uv](https://docs.astral.sh/uv/reference/settings/) - `pyproject.toml`'s `tool.uv.constraint-dependencies`/`tool.uv.dev-dependencies`/`tool.uv.override-dependencies`
-   [Pixi](https://pixi.sh/latest/advanced/pyproject_toml/) - `pyproject.toml`'s `tool.pixi.pypi-dependencies`

This extension depends on [Microsoft's official Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) for `pip requirements` language support.
