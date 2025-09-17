import { extractRequirementsFromPyprojectToml } from './pyproject'
import { TextDocumentLike, extractPackageName } from './types'

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
            ['python', [7, 0, 7, 15]],
            ['requests', [8, 0, 8, 20]],
            ['foo', [9, 0, 9, 14]],
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

        expect(result).toEqual([['baz', [7, 0, 7, 14]]])
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

        expect(result).toEqual([['bar', [7, 0, 7, 14]]])
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

        expect(result).toEqual([['black', [7, 0, 7, 129]]])
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

        expect(result).toEqual([['black', [6, 0, 10, 55]]])
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

        // Test that we extract the right number of dependencies and their names
        expect(result).toHaveLength(4)
        expect(extractPackageName(result[0][0])).toBe('httpx')
        expect(extractPackageName(result[1][0])).toBe('gidgethub')
        expect(extractPackageName(result[2][0])).toBe('django')
        expect(extractPackageName(result[3][0])).toBe('django')

        // Test basic range structure (allow some flexibility in exact positions)
        expect(result[0][1]).toEqual([2, expect.any(Number), 2, expect.any(Number)])
        expect(result[1][1]).toEqual([3, expect.any(Number), 3, expect.any(Number)])
        expect(result[2][1]).toEqual([4, expect.any(Number), 4, expect.any(Number)])
        expect(result[3][1]).toEqual([5, expect.any(Number), 5, expect.any(Number)])
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

        // Test that we extract the right dependencies and their names
        expect(result).toHaveLength(2)
        expect(extractPackageName(result[0][0])).toBe('httpx')
        expect(extractPackageName(result[1][0])).toBe('gidgethub')

        // Test basic range structure
        expect(result[0][1]).toEqual([2, expect.any(Number), 2, expect.any(Number)])
        expect(result[1][1]).toEqual([5, expect.any(Number), 5, expect.any(Number)])
    })
})

describe('extractRequirementsFromPyprojectToml with uv', () => {
    it('should extract requirements from constraint-dependencies', () => {
        const document = makeTextDocumentLike(['[tool.uv]', 'constraint-dependencies = ["grpcio<1.65"]'])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toHaveLength(1)
        expect(extractPackageName(result[0][0])).toBe('grpcio')
        expect(result[0][1]).toEqual([1, expect.any(Number), 1, expect.any(Number)])
    })

    it('should extract requirements from dev-dependencies', () => {
        const document = makeTextDocumentLike(['[tool.uv]', 'dev-dependencies = ["ruff==0.5.0"]'])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toHaveLength(1)
        expect(extractPackageName(result[0][0])).toBe('ruff')
        expect(result[0][1]).toEqual([1, expect.any(Number), 1, expect.any(Number)])
    })

    it('should extract requirements from override-dependencies', () => {
        const document = makeTextDocumentLike(['[tool.uv]', 'override-dependencies = ["werkzeug==2.3.0"]'])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toHaveLength(1)
        expect(extractPackageName(result[0][0])).toBe('werkzeug')
        expect(result[0][1]).toEqual([1, expect.any(Number), 1, expect.any(Number)])
    })
})

describe('extractRequirementsFromPyprojectToml with PEP 735', () => {
    it('should extract requirements from dependency-groups', () => {
        const document = makeTextDocumentLike(['[dependency-groups]', 'test = ["pytest>7", "coverage"]'])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toHaveLength(2)
        expect(extractPackageName(result[0][0])).toBe('pytest')
        expect(extractPackageName(result[1][0])).toBe('coverage')
        expect(result[0][1]).toEqual([1, expect.any(Number), 1, expect.any(Number)])
        expect(result[1][1]).toEqual([1, expect.any(Number), 1, expect.any(Number)])
    })

    it('should extract requirements from dependency-groups, ignoring include-group', () => {
        const document = makeTextDocumentLike([
            '[dependency-groups]',
            'coverage = ["coverage[toml]"]',
            'test = ["pytest>7", {include-group = "coverage"}]',
        ])

        const result = extractRequirementsFromPyprojectToml(document)

        expect(result).toHaveLength(2)
        expect(extractPackageName(result[0][0])).toBe('coverage')
        expect(extractPackageName(result[1][0])).toBe('pytest')
        expect(result[0][1]).toEqual([1, expect.any(Number), 1, expect.any(Number)])
        expect(result[1][1]).toEqual([2, expect.any(Number), 2, expect.any(Number)])
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
            ['requests', [7, 0, 7, 20]],
            ['foo', [8, 0, 8, 14]],
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

        expect(result).toHaveLength(1)
        expect(extractPackageName(result[0][0])).toBe('poetry-core')
        expect(result[0][1]).toEqual([1, expect.any(Number), 1, expect.any(Number)])
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

        expect(result).toHaveLength(2)
        expect(extractPackageName(result[0][0])).toBe('hatchling')
        expect(extractPackageName(result[1][0])).toBe('hatch-vcs')
        expect(result[0][1]).toEqual([2, expect.any(Number), 2, expect.any(Number)])
        expect(result[1][1]).toEqual([3, expect.any(Number), 3, expect.any(Number)])
    })
})
