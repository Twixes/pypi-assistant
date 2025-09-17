import { LooseProjectNameRequirement, LooseProjectNameRequirementWithLocation } from 'pip-requirements-js'

export type RawRange = [startLine: number, startCharacter: number, endLine: number, endCharacter: number]

export interface PositionLike {
    line: number
    character: number
}

export interface RangeLike {
    start: PositionLike
    end: PositionLike
}

export interface TextDocumentLike {
    lineCount: number
    lineAt(line: number): { text: string; range: RangeLike }
    getText(): string
}

/** Requirements that can have a version spec inline get parsed in detail, ones that are just the package name (e.g. some pyproject.toml formats) are a string */
export type RequirementFound = LooseProjectNameRequirementWithLocation | string

/** Extract the package name from a RequirementFound, handling all variants of RequirementFound */
export function extractPackageName(requirement: RequirementFound): string {
    if (typeof requirement === 'string') {
        return requirement
    } else {
        return requirement.data.name.data
    }
}
