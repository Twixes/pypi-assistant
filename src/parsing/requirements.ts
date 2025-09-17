import { LooseProjectNameRequirementWithLocation, parsePipRequirementsLineLoosely } from 'pip-requirements-js'
import { TextDocumentLike, RawRange } from './types'

export function extractRequirementsFromPipRequirements(
    document: TextDocumentLike
): [LooseProjectNameRequirementWithLocation, RawRange][] {
    const requirements: [LooseProjectNameRequirementWithLocation, RawRange][] = []
    for (let line = 0; line < document.lineCount; line++) {
        let requirement: LooseProjectNameRequirementWithLocation | null
        const { text, range } = document.lineAt(line)
        try {
            requirement = parsePipRequirementsLineLoosely(text, { includeLocations: true })
        } catch {
            continue
        }
        if (requirement?.data.type !== 'ProjectName') continue

        requirements.push([requirement, [range.start.line, range.start.character, range.end.line, range.end.character]])
    }
    return requirements
}
