import dayjs from 'dayjs'
import { ProjectNameRequirement } from 'pip-requirements-js'
import * as semver from 'semver'
import vscode from 'vscode'
import { outputChannel } from './output'
import { RequirementsParser } from './parsing'
import { PyPI } from './pypi'

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
        const metadata = await pypi.fetchPackageMetadata(requirementWithRange[0])
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
    requirement: ProjectNameRequirement

    constructor(range: vscode.Range, requirement: ProjectNameRequirement) {
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
            const metadata = await pypi.fetchPackageMetadata(codeLens.requirement)
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

// Regex to check for a valid PIP requirement up to the cursor position and maybe a version after the curosor
// TODO: Maybe use grammar parsing instead of regex to handle the format at one place only
// Package name
const nameRe = '(?<name>[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*)'
// Optional extras
const extrasRe = '(?<extras>\\[[A-Za-z0-9]+(?:\\s*,\\s*[A-Za-z0-9]+)*\\])?'
// Operator
const versionOpsRe = '(?<versionOps>(?:<=|>=|!=|==|===|<|>|~=))'
// Chars that might be before the cursor inside of an operator
const versionOpsPartOneRe = '(?<versionOpsPartOne>(?:[!=~<>=]))'
// Chars that might be after the cursor inside of an operator
const versionOpsPartTwoRe = '(?<versionOpsPartTwo>(?:=|==))'
// Version
const versionRe = '(?<version>[A-Za-z0-9._*-+!]+)'
// Regex that matches the part from package name to operator (handles operator parts)
const requirementRegex = new RegExp(`^${nameRe}\\s*${extrasRe}\\s*(${versionOpsRe}\\s*|${versionOpsPartOneRe})?$`)
// Regex that matches the part from operator to end of version (handles operator parts)
const versionRegex = new RegExp(`^(?:\\s*${versionOpsRe}|${versionOpsPartTwoRe})?\\s*${versionRe}?`)

export class PyPICompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
    constructor(public requirementsParser: RequirementsParser, public pypi: PyPI) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const line = document.lineAt(position).text
        const beforeCursor = line.substring(0, position.character)

        // Before cursor there must be a package name maybe extras and a version operator
        const requirementMatch = beforeCursor.match(requirementRegex)
        if (!requirementMatch) {
            return undefined
        }
        const requirement = this.requirementsParser.getAtPosition(document, position)
        if (!requirement) {
            return undefined
        }

        return new Promise(async (resolve) => {
            try {
                const metadata = await this.pypi.fetchPackageMetadata(requirement[0])
                const rawVersions = Object.keys(metadata.releases)
                // Sort versions: semver versions first (sorted by semver), then non-semver versions (sorted alphabetically)
                const semverVersions = rawVersions.filter((v) => semver.valid(v)).sort(semver.rcompare)
                const nonSemverVersions = rawVersions
                    .filter((v) => !semver.valid(v))
                    .sort()
                    .reverse()
                const allVersions = semverVersions.concat(nonSemverVersions)

                // After the cursor there may be a version that we want to replace
                const afterCursor = line.substring(position.character)
                const versionMatch = afterCursor.match(versionRegex)

                const op = requirementMatch.groups?.versionOps
                const opPartOne = requirementMatch.groups?.versionOpsPartOne
                const opTwo = versionMatch?.groups?.versionOps
                const opPartTwo = versionMatch?.groups?.versionOpsPartTwo

                // Build the suggested operator by analyzing the context
                let operator: string
                let finalOperator: string

                // Check for split operators (cursor between parts)
                if ((op === '>' || op === '<' || op === '!' || op === '~') && opPartTwo === '=') {
                    // Special case: cursor between > and =, < and =, ! and =, or ~ and =
                    finalOperator = `${op}${opPartTwo}`
                    operator = opPartTwo
                } else if (opPartOne === '=' && opPartTwo === '=') {
                    // Cursor between first and second = in ==
                    finalOperator = '=='
                    operator = ''
                } else if (op === '==' && opPartTwo === '=') {
                    // Cursor between second and third = in ===
                    finalOperator = '==='
                    operator = opPartTwo
                } else if (opPartOne && opPartTwo) {
                    // Cursor is between two parts of an operator (generic case)
                    const fullOp = `${opPartOne}${opPartTwo}`
                    finalOperator = fullOp
                    operator = opPartTwo
                } else if (opPartOne) {
                    // Cursor is after first char of a longer operator
                    if (opPartOne === '=') {
                        // Single = should become ==
                        operator = '='
                        finalOperator = '=='
                    } else {
                        operator = '='
                        finalOperator = `${opPartOne}=`
                    }
                } else if (opPartTwo) {
                    // Cursor is before = or ==
                    operator = opPartTwo
                    finalOperator = `=${opPartTwo}`
                } else if (opTwo) {
                    // Cursor is before a full valid operator
                    operator = opTwo
                    finalOperator = opTwo
                } else if (op) {
                    // Or cursor is behind a full valid operator
                    operator = ''
                    finalOperator = op
                } else {
                    // No operator before and after the cursor
                    operator = '=='
                    finalOperator = '=='
                }

                // Build all suggested items
                const items = allVersions.map((version, index) => {
                    const item = new vscode.CompletionItem(
                        `${finalOperator}${version}`,
                        vscode.CompletionItemKind.Constant
                    )
                    // If a complete operator already exists and no partial operators, insert only version
                    if (op && !opPartOne && !opPartTwo) {
                        item.insertText = version
                    } else {
                        item.insertText = `${operator}${version}`
                    }
                    item.sortText = String(index).padStart(5, '0')

                    // If there is a version after the cursor, replace it
                    if (versionMatch) {
                        const start = position
                        const end = position.translate(0, versionMatch[0].length)
                        item.range = new vscode.Range(start, end)
                    }
                    return item
                })

                outputChannel.appendLine(`Suggesting ${items.length} items`)
                resolve(items)
            } catch (err) {
                outputChannel.appendLine(`Failed to provide PIP version code completion: ${err}`)
                resolve(undefined)
            }
        })
    }
}

export function activate(_context: vscode.ExtensionContext) {
    requirementsParser = new RequirementsParser()
    pypi = new PyPI()
    const hoverProvider = new PyPIHoverProvider(requirementsParser, pypi)
    const codeLensProvider = new PyPICodeLensProvider(requirementsParser, pypi)
    const completionItemProvider = new PyPICompletionItemProvider(requirementsParser, pypi)
    const completionTriggerChars = ['=', '<', '>', '~', '!', ' ']
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
