import dayjs from 'dayjs'
import { ProjectNameRequirement } from 'pip-requirements-js'
import * as semver from 'semver'
import vscode from 'vscode'
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

export class PyPICompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
    constructor(public requirementsParser: RequirementsParser, public pypi: PyPI) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        // Check if the cursor is behind an '=' character otherwise we don't provide any completions
        const line = document.lineAt(position).text.substring(0, position.character)
        const match = line.match(/=\s*$/)
        if (!match) {
            return undefined
        }

        return (async () => {
            try {
                const requirements = this.requirementsParser.getAtPosition(document, position)
                if (!requirements) {
                    return undefined
                }
                const metadata = await pypi.fetchPackageMetadata(requirements[0])
                const allVersions = Object.keys(metadata.releases)

                // Sort versions: semver versions first (sorted by semver), then non-semver versions (sorted alphabetically)
                const semverVersions = allVersions.filter((v) => semver.valid(v)).sort(semver.rcompare)
                const nonSemverVersions = allVersions
                    .filter((v) => !semver.valid(v))
                    .sort()
                    .reverse()
                const versions = [...semverVersions, ...nonSemverVersions]

                return versions.map((version, index) => {
                    const item = new vscode.CompletionItem(version, vscode.CompletionItemKind.Constant)
                    item.insertText = version
                    item.sortText = String(index).padStart(5, '0')
                    return item
                })
            } catch (err) {
                console.error('Failed to provide PIP version code completion:', err)
                return undefined
            }
        })()
    }
}

export function activate(_context: vscode.ExtensionContext) {
    requirementsParser = new RequirementsParser()
    pypi = new PyPI()
    const hoverProvider = new PyPIHoverProvider(requirementsParser, pypi)
    const codeLensProvider = new PyPICodeLensProvider(requirementsParser, pypi)
    const completionItemProvider = new PyPICompletionItemProvider(requirementsParser, pypi)
    vscode.languages.registerCodeLensProvider('pip-requirements', codeLensProvider)
    vscode.languages.registerHoverProvider('pip-requirements', hoverProvider)
    vscode.languages.registerCompletionItemProvider('pip-requirements', completionItemProvider, '=', ' ')
    vscode.languages.registerCodeLensProvider('toml', codeLensProvider)
    vscode.languages.registerHoverProvider('toml', hoverProvider)
    vscode.languages.registerCompletionItemProvider('toml', completionItemProvider, '=', ' ')
}

export function deactivate() {
    requirementsParser.clear()
    pypi.clear()
}
