import { LooseProjectNameRequirement, Requirement, parsePipRequirementsLineLoosely } from 'pip-requirements-js'
import { TextDocumentLike, RawRange } from './types'

export function extractRequirementsFromPipRequirements(
    document: TextDocumentLike
): [LooseProjectNameRequirement, RawRange][] {
    const requirements: [LooseProjectNameRequirement, RawRange][] = []
    for (let line = 0; line < document.lineCount; line++) {
        let requirement: Requirement | null
        const { text, range } = document.lineAt(line)
        try {
            requirement = parsePipRequirementsLineLoosely(text)
        } catch {
            continue
        }
        if (requirement?.type !== 'ProjectName') continue
        requirements.push([requirement, [range.start.line, range.start.character, range.end.line, range.end.character]])
    }
    return requirements
}
