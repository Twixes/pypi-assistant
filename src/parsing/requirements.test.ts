import { extractRequirementsFromPipRequirements } from './requirements'
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

describe('extractRequirementsFromPipRequirements', () => {
    it('should extract exact equal requirements with comment', () => {
        const document = makeTextDocumentLike(['# Comment', 'package1==1.0.0', 'package2 == 2.0.0', 'package3==3.0.0'])

        const result = extractRequirementsFromPipRequirements(document)

        expect(result).toEqual([
            [{ name: 'package1', type: 'ProjectName' }, [1, 0, 1, 13]],
            [{ name: 'package2', type: 'ProjectName' }, [2, 0, 2, 15]],
            [{ name: 'package3', type: 'ProjectName' }, [3, 0, 3, 13]],
        ])
    })
})
