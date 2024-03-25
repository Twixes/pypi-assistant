import { extractRequirementsFromPyprojectToml } from './poetry'
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

describe('extractRequirementsFromPyprojectToml', () => {
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
