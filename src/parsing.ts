export interface PackageRequirement {
    id: string
    extras: string[]
    constraints: [string, string][]
}

const DECONSTRUCTION_REGEX: RegExp =
    /^([\w\d._-]+)(\[[\w\d,._-]*\])?(?:(==?|~=?|>=?|<=?)([\w\d._*-]*)(?:,(?:(==?|~=?|>=?|<=?)([\w\d._*-]*))?)?)?$/i

export function extractPackageRequirement(lineText: string): PackageRequirement | null {
    const match = lineText.replace(/(?:\s*(?:(?=#).*)?$|\s+)/g, '').match(DECONSTRUCTION_REGEX)
    if (!match) return null

    const constraints: [string, string][] = []
    if (match[4]) constraints.push([match[3], match[4]])
    if (match[6]) constraints.push([match[5], match[6]])
    return {
        id: match[1].toLowerCase().replace(/[._]/g, '-'),
        extras: match[2] ? match[2].split(',') : [],
        constraints,
    }
}
