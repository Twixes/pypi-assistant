import { extractRequirementsFromPyprojectToml } from './pyproject'
import { TextDocumentLike } from './types'

export function makeTextDocumentLike(lines: string[]): TextDocumentLike {
    return {
        getText: jest.fn(() => lines.join('\n')),
        lineAt: jest.fn((line) => ({
            text: lines[line],
            range: {
                start: { line, character: 0 },
                end: { line, character: lines[line].length - 2 },
            },
        })),
        lineCount: lines.length,
    }
}

describe('extractRequirementsFromPyprojectToml with Poetry', () => {
    it('should extract basic requirements', () => {
        const document = makeTextDocumentLike([
            '[tool.poetry]',
            'name = "poetry-demo"',
            'version = "0.1.0"',
            'description = "Test"',
            'authors = ["Michael Matloka"]',
            '',
            '[tool.poetry.dependencies]',
            'python = "^3.7"',
            'requests = "^2.22.0"',
            'foo = "<6.6.6"',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([
            [{ name: 'python', type: 'ProjectName' }, [7, 0, 7, 15]],
            [{ name: 'requests', type: 'ProjectName' }, [8, 0, 8, 20]],
            [{ name: 'foo', type: 'ProjectName' }, [9, 0, 9, 14]],
        ])
    })

    it('should extract requirements from groups', () => {
        const document = makeTextDocumentLike([
            '[tool.poetry]',
            'name = "poetry-demo"',
            'version = "0.1.0"',
            'description = "Test"',
            'authors = ["Michael Matloka"]',
            '',
            '[tool.poetry.group.turbo.dependencies]',
            'baz = ">6.6.6"',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([[{ name: 'baz', type: 'ProjectName' }, [7, 0, 7, 14]]])
    })

    it('should extract legacy dev requirements', () => {
        const document = makeTextDocumentLike([
            '[tool.poetry]',
            'name = "poetry-demo"',
            'version = "0.1.0"',
            'description = "Test"',
            'authors = ["Michael Matloka"]',
            '',
            '[tool.poetry.dev-dependencies]',
            'bar = ">6.6.6"',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([[{ name: 'bar', type: 'ProjectName' }, [7, 0, 7, 14]]])
    })

    it('should extract complex requirements', () => {
        const document = makeTextDocumentLike([
            '[tool.poetry]',
            'name = "poetry-demo"',
            'version = "0.1.0"',
            'description = "Test"',
            'authors = ["Michael Matloka"]',
            '',
            '[tool.poetry.dependencies]',
            `black = {version = "19.10b0", allow-prereleases = true, python = "^3.7", markers = "platform_python_implementation == 'CPython'"}`,
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([[{ name: 'black', type: 'ProjectName' }, [7, 0, 7, 129]]])
    })

    it('should extract expanded requirements', () => {
        const document = makeTextDocumentLike([
            '[tool.poetry]',
            'name = "poetry-demo"',
            'version = "0.1.0"',
            'description = "Test"',
            'authors = ["Michael Matloka"]',
            '',
            '[tool.poetry.group.dev.dependencies.black]',
            'version = "19.10b0"',
            'allow-prereleases = true',
            'python = "^3.7"',
            `markers = "platform_python_implementation == 'CPython'"`,
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([[{ name: 'black', type: 'ProjectName' }, [6, 0, 10, 55]]])
    })
})

describe('extractRequirementsFromPyprojectToml with PEP 631', () => {
    it('should extract basic requirements', () => {
        const document = makeTextDocumentLike([
            '[project]',
            'dependencies = [',
            '  "httpx",',
            '  "gidgethub[httpx]>4.0.0",',
            '  "django>2.1; os_name != \'nt\'",',
            '  "django>2.0; os_name == \'nt\'"',
            ']',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([
            [{ name: 'httpx', type: 'ProjectName' }, [2, 2, 2, 9]],
            [{ name: 'gidgethub', type: 'ProjectName' }, [3, 2, 3, 26]],
            [{ name: 'django', type: 'ProjectName' }, [4, 2, 4, 31]],
            [{ name: 'django', type: 'ProjectName' }, [5, 2, 5, 31]],
        ])
    })

    it('should extract requirements from extras', () => {
        const document = makeTextDocumentLike([
            '[project]',
            'dependencies = [',
            '  "httpx",',
            ']',
            '[project.optional-dependencies]',
            'cli = ["gidgethub[httpx]>4.0.0"]',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([
            [{ name: 'httpx', type: 'ProjectName' }, [2, 2, 2, 9]],
            [{ name: 'gidgethub', type: 'ProjectName' }, [5, 7, 5, 31]],
        ])
    })
})

describe('extractRequirementsFromPyprojectToml with uv', () => {
    it('should extract requirements from constraint-dependencies', () => {
        const document = makeTextDocumentLike(['[tool.uv]', 'constraint-dependencies = ["grpcio<1.65"]'])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([[{ name: 'grpcio', type: 'ProjectName' }, [1, 27, 1, 40]]])
    })

    it('should extract requirements from dev-dependencies', () => {
        const document = makeTextDocumentLike(['[tool.uv]', 'dev-dependencies = ["ruff==0.5.0"]'])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([[{ name: 'ruff', type: 'ProjectName' }, [1, 20, 1, 33]]])
    })

    it('should extract requirements from override-dependencies', () => {
        const document = makeTextDocumentLike(['[tool.uv]', 'override-dependencies = ["werkzeug==2.3.0"]'])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([[{ name: 'werkzeug', type: 'ProjectName' }, [1, 25, 1, 42]]])
    })
})

describe('extractRequirementsFromPyprojectToml with PEP 735', () => {
    it('should extract requirements from dependency-groups', () => {
        const document = makeTextDocumentLike(['[dependency-groups]', 'test = ["pytest>7", "coverage"]'])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([
            [{ name: 'pytest', type: 'ProjectName' }, [1, 8, 1, 18]],
            [{ name: 'coverage', type: 'ProjectName' }, [1, 20, 1, 30]],
        ])
    })

    it('should extract requirements from dependency-groups, ignoring include-group', () => {
        const document = makeTextDocumentLike([
            '[dependency-groups]',
            'coverage = ["coverage[toml]"]',
            'test = ["pytest>7", {include-group = "coverage"}]',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([
            [{ name: 'coverage', type: 'ProjectName' }, [1, 12, 1, 28]],
            [{ name: 'pytest', type: 'ProjectName' }, [2, 8, 2, 18]],
        ])
    })
})

describe('extractRequirementsFromPyprojectToml with Pixi', () => {
    it('should extract basic requirements', () => {
        const document = makeTextDocumentLike([
            '[tool.pixi]',
            'name = "pixi-demo"',
            'version = "0.1.0"',
            'description = "Test"',
            'authors = ["Michael Matloka"]',
            '',
            '[tool.pixi.pypi-dependencies]',
            'requests = "^2.22.0"',
            'foo = "<6.6.6"',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([
            [{ name: 'requests', type: 'ProjectName' }, [7, 0, 7, 20]],
            [{ name: 'foo', type: 'ProjectName' }, [8, 0, 8, 14]],
        ])
    })
})

describe('extractRequirementsFromPyprojectWithBuildSystem', () => {
    it('should extract requirements from a pyproject.toml with a build-system', () => {
        const document = makeTextDocumentLike([
            '[build-system]',
            'requires = ["poetry-core>=1.0.0"]',
            'build-backend = "poetry.core.masonry.api"',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([[{ name: 'poetry-core', type: 'ProjectName' }, [1, 12, 1, 32]]])
    })

    it('should identify each build-system dependency', () => {
        const document = makeTextDocumentLike([
            '[build-system]',
            'requires = [',
            '  "hatchling",',
            '  "hatch-vcs",',
            ']',
            'build-backend = "hatchling.build"',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toEqual([
            [{ name: 'hatchling', type: 'ProjectName' }, [2, 2, 2, 13]],
            [{ name: 'hatch-vcs', type: 'ProjectName' }, [3, 2, 3, 13]],
        ])
    })
})
