import dayjs from 'dayjs'
import { LooseProjectNameRequirementWithLocation } from 'pip-requirements-js'
import * as semver from 'semver'
import vscode from 'vscode'
import { RequirementsParser } from './parsing'
import { PyPI } from './pypi'
import { RequirementFound, extractPackageName } from './parsing/types'

/* Partial model of the package response returned by PyPI. */
export interface PackageMetadata {
    info: {
        name: string
        summary: string
        home_page: string
        author: string
        author_email: string
        package_url: string
        license: string
        version: string
        release_url: string
    }
    releases: Record<string, { upload_time: string }[]>
}

let requirementsParser: RequirementsParser
let pypi: PyPI

function linkify(text: string, link?: string): string {
    return link ? `[${text}](${link})` : text
}

export class PyPIHoverProvider implements vscode.HoverProvider {
    constructor(public requirementsParser: RequirementsParser, public pypi: PyPI) {}

    public async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
        const requirementWithRange = this.requirementsParser.getAtPosition(document, position)
        if (!requirementWithRange) {
            return null
        }
        const metadata = await pypi.fetchPackageMetadata(extractPackageName(requirementWithRange[0]))
        if (metadata === null) {
            return null
        }
        return new vscode.Hover(this.formatPackageMetadata(metadata))
    }

    private formatPackageMetadata(metadata: PackageMetadata): string {
        const { info, releases } = metadata
        const summarySubPart: string = info.summary ? ` – ${linkify(info.summary, info.home_page)}` : ''
        const metadataPresentation: string[] = [`**${linkify(info.name, info.package_url)}${summarySubPart}**`]
        const emailSubpart: string = info.author_email ? ` (${info.author_email})` : ''
        const authorSubpart: string | null =
            info.author && info.author_email ? `By ${info.author}${emailSubpart}.` : null
        const licenseSubpart: string | null = info.license ? `License: ${info.license}.` : null
        if (authorSubpart || licenseSubpart)
            metadataPresentation.push([authorSubpart, licenseSubpart].filter(Boolean).join(' '))
        metadataPresentation.push(
            `Latest version: ${linkify(info.version, info.release_url)} (released on ${dayjs(
                releases[info.version][0].upload_time
            ).format('D MMMM YYYY')}).`
        )
        return metadataPresentation.join('\n\n')
    }
}

class PyPICodeLens extends vscode.CodeLens {
    requirement: RequirementFound

    constructor(range: vscode.Range, requirement: RequirementFound) {
        super(range)
        this.requirement = requirement
    }
}

export class PyPICodeLensProvider implements vscode.CodeLensProvider<PyPICodeLens> {
    constructor(public requirementsParser: RequirementsParser, public pypi: PyPI) {}

    public provideCodeLenses(document: vscode.TextDocument): PyPICodeLens[] {
        const codeLensEnabled = vscode.workspace.getConfiguration('pypiAssistant').get('codeLens')
        if (!codeLensEnabled) {
            return []
        }
        const requirements = this.requirementsParser.getAll(document)
        return requirements.map(([requirement, range]) => new PyPICodeLens(range, requirement))
    }

    public async resolveCodeLens(codeLens: PyPICodeLens, _: vscode.CancellationToken): Promise<PyPICodeLens> {
        let title: string
        try {
            const metadata = await pypi.fetchPackageMetadata(extractPackageName(codeLens.requirement))
            title = this.formatPackageMetadata(metadata)
        } catch (e) {
            title = (e as Error).message
        }
        codeLens.command = {
            command: '',
            title,
        }
        return codeLens
    }

    private formatPackageMetadata(metadata: PackageMetadata): string {
        const { info } = metadata
        return `Latest version: ${info.version}`
    }
}

export class PyPICompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
    constructor(public requirementsParser: RequirementsParser, public pypi: PyPI) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const parsedResult = this.requirementsParser.getAtPosition(document, position)
        if (!parsedResult) {
            return []
        }

        const [requirement, requirementRange] = parsedResult

        // Only handle LooseProjectNameRequirementWithLocation requirements
        if (typeof requirement === 'string') {
            return []
        }

        const packageName = extractPackageName(requirement)
        const lineText = document.lineAt(position.line).text

        // For TOML files, the requirement locations are already adjusted to be absolute within the line
        // For pip requirements files, they're relative to the requirement start
        const isTomlFile = document.languageId === 'toml'

        // Determine cursor position context
        const cursorContext = this.analyzeCursorContext(
            lineText,
            position.character,
            requirement,
            requirementRange.start.character,
            isTomlFile
        )
        if (!cursorContext) {
            return []
        }

        try {
            // Fetch package metadata to get available versions
            const metadata = await this.pypi.fetchPackageMetadata(packageName)
            if (!metadata) {
                return []
            }

            // Get and sort versions
            const versions = this.getSortedVersions(metadata.releases)

            // Generate completion items
            return this.generateCompletionItems(versions, cursorContext, position.line, metadata.releases)
        } catch (error) {
            // Return empty array on error (e.g., package not found)
            return []
        }
    }

    private analyzeCursorContext(
        lineText: string,
        cursorPosition: number,
        requirement: LooseProjectNameRequirementWithLocation,
        requirementStartColumn: number,
        isTomlFile: boolean
    ): { operator: string; replaceRange: { start: number; end: number } } | null {
        const nameEnd = requirement.data.name.location.endIdx
        const versionSpecs = requirement.data.versionSpec || []

        // For TOML files, requirement locations are already absolute within the line
        // For pip files, they're relative to the requirement start
        const relativeCursorPosition = isTomlFile ? cursorPosition : cursorPosition - requirementStartColumn
        const getAbsolutePosition = (relativePos: number) =>
            isTomlFile ? relativePos : requirementStartColumn + relativePos

        // Don't provide completions after environment markers or comments
        const envMarkerIndex = lineText.indexOf(';')
        const commentIndex = lineText.indexOf('#')
        const stopIndex = Math.min(
            envMarkerIndex === -1 ? Infinity : envMarkerIndex,
            commentIndex === -1 ? Infinity : commentIndex
        )

        if (stopIndex !== Infinity && cursorPosition >= stopIndex) {
            return null
        }

        // Find which version spec the cursor is in/near
        for (const spec of versionSpecs) {
            // If cursor is within this version spec, replace the entire spec
            if (relativeCursorPosition >= spec.location.startIdx && relativeCursorPosition <= spec.location.endIdx) {
                const operator = spec.data.operator.data
                return {
                    operator: operator === '=' ? '==' : operator,
                    replaceRange: {
                        start: getAbsolutePosition(spec.location.startIdx),
                        end: getAbsolutePosition(spec.location.endIdx),
                    },
                }
            }

            // If cursor is shortly after this spec (within whitespace), also replace this spec
            if (relativeCursorPosition > spec.location.endIdx) {
                const afterSpecStart = getAbsolutePosition(spec.location.endIdx)
                const afterSpec = lineText.substring(afterSpecStart, cursorPosition)
                // Only whitespace between spec and cursor
                if (/^\s+$/.test(afterSpec)) {
                    // Always replace the entire spec when cursor is after it in whitespace
                    const operator = spec.data.operator.data === '=' ? '==' : spec.data.operator.data
                    return {
                        operator,
                        replaceRange: {
                            start: getAbsolutePosition(spec.location.startIdx),
                            end: cursorPosition,
                        },
                    }
                }
            }
        }

        // Check if cursor is after a comma (for new version spec after last one)
        if (versionSpecs.length > 0) {
            const lastSpec = versionSpecs[versionSpecs.length - 1]
            const afterSpecStart = getAbsolutePosition(lastSpec.location.endIdx)
            const afterLastSpec = lineText.substring(afterSpecStart)
            const commaMatch = afterLastSpec.match(/^\s*,\s*/)

            if (commaMatch && relativeCursorPosition >= lastSpec.location.endIdx + commaMatch[0].length) {
                const firstOperator = versionSpecs[0].data.operator.data
                const complementaryOperator = this.getComplementaryOperator(firstOperator)
                return {
                    operator: complementaryOperator,
                    replaceRange: { start: cursorPosition, end: cursorPosition },
                }
            }
        }

        // Check if cursor is after package name (new first version spec)
        if (relativeCursorPosition >= nameEnd) {
            // Skip trailing whitespace for insertion point
            let relativeInsertPosition = relativeCursorPosition
            while (
                relativeInsertPosition > nameEnd &&
                lineText[getAbsolutePosition(relativeInsertPosition) - 1] === ' '
            ) {
                relativeInsertPosition--
            }
            return {
                operator: '==',
                replaceRange: {
                    start: getAbsolutePosition(relativeInsertPosition),
                    end: cursorPosition,
                },
            }
        }
        return null
    }

    private getComplementaryOperator(operator: string): string {
        switch (operator) {
            case '>':
                return '<='
            case '>=':
                return '<'
            case '<':
                return '>='
            case '<=':
                return '>'
            default:
                return '=='
        }
    }

    private getSortedVersions(releases: Record<string, { upload_time: string }[]>): string[] {
        const versions = Object.keys(releases)
        // Sort versions using semver, fallback to alphabetical
        return versions.sort((a, b) => {
            try {
                // Try semver comparison first
                const aValid = semver.valid(a)
                const bValid = semver.valid(b)
                if (aValid && bValid) {
                    return semver.rcompare(a, b) // Reverse compare for descending order
                }
                // If only one is valid semver, prioritize it
                if (aValid && !bValid) return -1
                if (!aValid && bValid) return 1
                // Fall back to alphabetical comparison (reverse for descending)
                return b.localeCompare(a)
            } catch {
                // Fallback to alphabetical comparison
                return b.localeCompare(a)
            }
        })
    }

    private generateCompletionItems(
        versions: string[],
        context: { operator: string; replaceRange: { start: number; end: number } },
        lineNumber: number,
        releases: Record<string, { upload_time: string }[]>
    ): vscode.CompletionItem[] {
        return versions.map((version, index) => {
            const completionItem = new vscode.CompletionItem(
                `${context.operator}${version}`,
                vscode.CompletionItemKind.Value
            )
            completionItem.insertText = `${context.operator}${version}`
            completionItem.range = new vscode.Range(
                new vscode.Position(lineNumber, context.replaceRange.start),
                new vscode.Position(lineNumber, context.replaceRange.end)
            )
            completionItem.sortText = String(index).padStart(4, '0') // Latest versions first
            completionItem.detail = `Released on ${dayjs(releases[version][0].upload_time).format('D MMMM YYYY')}`
            return completionItem
        })
    }
}

export function activate(_context: vscode.ExtensionContext) {
    requirementsParser = new RequirementsParser()
    pypi = new PyPI()
    const hoverProvider = new PyPIHoverProvider(requirementsParser, pypi)
    const codeLensProvider = new PyPICodeLensProvider(requirementsParser, pypi)
    const completionItemProvider = new PyPICompletionItemProvider(requirementsParser, pypi)
    const completionTriggerChars = [
        '=',
        '<',
        '>',
        '~',
        '!',
        ',',
        ' ',
        '.',
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
    ]
    vscode.languages.registerCodeLensProvider('pip-requirements', codeLensProvider)
    vscode.languages.registerHoverProvider('pip-requirements', hoverProvider)
    vscode.languages.registerCompletionItemProvider(
        'pip-requirements',
        completionItemProvider,
        ...completionTriggerChars
    )
    vscode.languages.registerCodeLensProvider('toml', codeLensProvider)
    vscode.languages.registerHoverProvider('toml', hoverProvider)
    vscode.languages.registerCompletionItemProvider('toml', completionItemProvider, ...completionTriggerChars)
}

export function deactivate() {
    requirementsParser.clear()
    pypi.clear()
}
